# Phase 67 — Anzeigefehler-Audit, Firmware-Absturzpfad, Config-Fehlermeldung

**Goal:** Drei Fehlerfamilien abräumen, die alle dasselbe Muster haben: etwas scheitert still. Tote Schreibziele im Dashboard (Werte werden berechnet und verschwinden), ein offener Absturzpfad im ESP-Frame-Codec, und eine Fehlermeldung im Kart-Fenster, die auf die falsche Ebene zeigt.

**Architecture:** Alle drei Befunde stammen aus systematischer Suche, nicht aus Lesen: ein Abgleich **aller** `id`-Attribute gegen **alle** Lookups (inklusive des `setText`-Zweigs), Fuzzing von `frame.pack` mit `inf`/`nan`/`None`/`str`, und eine Messung des Config-Schreibwegs im **Hauptprozess** statt im Renderer. Dazu die Stub-Umgebung (`test/mpstub.py`), die `sender.py` und `bridge.py` erstmals unter CPython ausführbar macht.

**Branch:** `feat/phase-65-live-tab-seitenkonzept` (Phasen 65–67 teilen sich einen Branch).

## Locked Decisions

- **`setText()` und `$()` schlucken fehlende Elemente weiterhin still** — der Detektor ersetzt den Laufzeitfehler. Ein werfender `setText` hätte jedes Redesign zur Absturzquelle gemacht.
- **Der Detektor wurde erst gegen `HEAD` validiert**, wo `lapCountText` schon fehlte: ein Finder, der einen bekannten Fall nicht findet, taugt nicht (siehe Memory „Anzeigefehler-Audit").
- **`_i()` sättigt, es wirft nicht.** Die Funktion sagt ausdrücklich „sättigt, wirft nie" — `NaN` war abgefangen, Unendlich vergessen. Statt den Aufrufer abzusichern, hält der Schutzwall jetzt, was er verspricht.
- **Der Stub bleibt minimal, aber nicht gutmütig:** `espnow.add_peer` wirft bei bekanntem Peer wie das Original. Ein freundlicher Stub würde Peer-Verwaltungsfehler verdecken.
- **Messungen des Serial-Schreibwegs gehören in den Hauptprozess.** `window.rasiSerial` ist per `contextBridge` eingefroren; ein Recorder, der `writeLine` im Renderer ersetzt, wird stillschweigend nicht installiert und meldet dann fälschlich null geschriebene Zeilen.
- **`bridgeSend` bekommt ein optionales `onFail`** — bestehende Aufrufer bleiben unverändert.
- **Die Akku-Pille in der Topbar hat auf der Übersichtsseite kein Bezugs-Kart.** Statt den zuletzt gewählten SoC zu zeigen, nennt dort jede Kachel ihren eigenen.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `index.html` | fehlende Ziele: `lapCountText`, Tabellenkopf, Fahrer-Hero-Kacheln |
| Modify | `src/laps-drivers.js` | `renderLapTable` schreibt in den `<tbody>`; Kopf/Empty-State |
| Modify | `src/live-ui.js` | Rundenlisten im 1-Hz-Loop; Akku-Pille pro Kachel |
| Modify | `src/app-init.js` | Format-Dropdown im Neues-Rennen-Dialog; Sektor-Hinweis als Toast |
| Modify | `src/kart-bar.js` | `focus({ preventScroll: true })` im 1-Hz-Rebuild |
| Modify | `src/track.js` | Sektor-Hinweis |
| Modify | `src/ui-glue.js` | `hzText` aus `_lastHz`; `activePart()`-`null` abfangen |
| Modify | `esp_libs/frame.py` | `_i()` sättigt auch bei `inf`/`-inf` |
| Modify | `bridge.py` | `kart_host` erst hinter der Limit-Prüfung setzen |
| Create | `test/mpstub.py` | MicroPython-Stubs (utime, ujson, ubinascii, ustruct, machine, network, espnow, esp32) |
| Create | `test/test_firmware.py` | Sender-Hauptschleife, Bridge-Empfang, Kart-Limit, Rückkanal |
| Modify | `test/test_frame.py` | `inf`/`nan`-Sättigung |
| Modify | `main.js` | `serial:write` meldet zurück, ob geschrieben wurde |
| Modify | `src/rasicross.js` | `bridgeSend` wertet das Promise aus, optionales `onFail` |
| Modify | `src/kart-settings-window.js` | nennt die richtige Ebene, stoppt den Ack-Timer |

Reihenfolge: 1 → 2 → 3 (je Task ein Commit).

## Task 1 — Tote Schreibziele und stille Fehlanzeigen (`9430725`)

- [x] Detektor bauen: alle `id`-Attribute gegen alle Lookups, inklusive `setText`-Zweig; gegen `HEAD` validieren.
- [x] `renderLapTable()` schrieb sein `innerHTML` in die `<table>` statt in den `<tbody>` — löschte bei **jedem** Render Kopfzeile und `tbody`-Anker (gemessen: `theadRows` 0 schon nach dem Init-Render).
- [x] Kopfzeile kannte fünf Spalten, die Zeilen lieferten sechs — die Delta-Spalte hatte nie eine Überschrift. Kopf und Empty-State ergänzt.
- [x] `lapCountText` existierte im Markup nicht; die `card-sub` trägt die Id jetzt.
- [x] `renderLapTable`/`renderLiveLapList` laufen im 1-Hz-Loop mit (vorher nur beim Start und wenn das **aktive** Kart die Linie kreuzte). Ein HTML-Diff hält den Sekundentakt still.
- [x] Akku-Pille: auf der Übersicht nennt jede Kachel ihren eigenen SoC.
- [x] `focus({ preventScroll: true })` im 1-Hz-Rebuild der Chip-Leiste (Gegenprobe: mit Chip-Fokus 600 → 0, ohne Fokus blieb es bei 600).
- [x] Format-Dropdown im Neues-Rennen-Dialog schaltet seine Felder um — `newRaceLapsField` stand auf `hidden`, die Rundenzahl war unerreichbar und blieb still auf 10.
- [x] Sektor-Hinweis läuft als Toast (`sectorClickHint` war einem Redesign zum Opfer gefallen; der 200-ms-Spiegel auf `sectorStatus2/3` kann einen Toast nicht überschreiben).
- [x] Fahrer-Hero: drei Kacheln für Fahrzeit, Top-Speed und Streckenzahl ergänzt (das auto-fit-Raster bricht von selbst um).
- [x] `hzText`: beide Schreiber nehmen `_lastHz` (gemessen über 200 Abtastungen: 8 % zeigten 0 statt der Rate, rund 80 ms pro Sekunde).
- [x] `ui-glue`: `activePart()` liefert seit Phase 39 `null`, sobald das aktive Kart kein Teilnehmer ist — der Spiegel warf 5× pro Sekunde in sein eigenes `catch`.

## Task 2 — `inf`-Absturz im Frame-Codec, gekapertes Legacy-Feld (`f739892`)

- [x] `test/mpstub.py`: Stubs für utime, ujson, ubinascii, ustruct, machine, network, espnow, esp32 — `sender.py` und `bridge.py` laufen damit unter CPython. `espnow.add_peer` wirft bei bekanntem Peer wie das Original.
- [x] `test/test_firmware.py`: Sender-Hauptschleife (300 Runden, gültige Frames, Auto-Pairing per `bridge_hello`), Bridge-Empfang gegen alle 21 Dashboard-Felder, Kart-Limit-Regression, kompletter Rückkanal Dashboard → Bridge → Kart → `config_ack`.
- [x] `frame.pack` warf bei `inf` statt zu sättigen: `int(round(inf))` ist ein `OverflowError`. Der Absturzpfad war vollständig offen — `frame.pack` steht in `radio.send()` **vor** dem `try`, `sender.py` sichert `link.send()` nicht ab, `main()` hat keinen Rettungsanker um die Hauptschleife. `_i()` sättigt jetzt auf die Feldgrenzen (gefunden per Fuzzing mit `inf`/`nan`/`None`/`str`).
- [x] `bridge.py`: `kart_host` wurde auch für ein abgewiesenes Kart gesetzt (ab dem 5., `MAX_KARTS` 4). Folge: `bridge_status.kart_mac` zeigte auf ein Kart, das die Bridge nicht führt, und `_forward_to_kart` schickte Steuerpakete ohne `target_mac` dorthin. Die Zuweisung steht jetzt hinter der Limit-Prüfung.
- [x] Gegenprobe: mit dem alten Stand 1 Failure + 2 Errors, mit den Fixes 72 grüne Python-Tests.

## Task 3 — Gescheitertes Schreiben auf den Port nicht dem Funk anlasten (`351cb6f`)

- [x] Nachgemessen im Hauptprozess: vollständige Config mit allen zehn Keys plus `target_mac`, rund 200 von 250 erlaubten Byte, mit Zeilenende (die Bridge liest mit `readline`). Die Keys decken sich mit `apply_config`, der Rückweg mit `ESP_CFG_FIELDS`. **Das Senden funktioniert.**
- [x] `main.js`: `serial:write` gab immer `undefined` zurück — ein geschlossener Port war vom Erfolgsfall nicht zu unterscheiden. Meldet jetzt zurück, ob geschrieben wurde.
- [x] `src/rasicross.js`: `bridgeSend` wertete das Promise von `writeLine` nie aus und meldete `true`; ein Schreibfehler wurde damit zur unbehandelten Rejection. Nimmt jetzt ein optionales `onFail` und räumt die Rejection ab.
- [x] `src/kart-settings-window.js`: meldete „Gesendet", danach „Keine Bestätigung vom Kart, Funkverbindung prüfen" — und schickte auf Fehlersuche beim Funk, obwohl die Zeile den PC nie verlassen hatte. Nennt jetzt die richtige Ebene, stoppt dabei den Ack-Timer; der IPC-Präfix wird für die Statuszeile abgeschnitten.

## Manuelle Abnahme (User, deferred)

- [ ] Rundentabelle im Detail-Tab: Kopfzeile mit sechs Spalten steht, die Rundenzahl wird angezeigt, nach einem Kart-Wechsel steht sofort die richtige Liste da.
- [ ] Übersichtsseite: jede Kachel zeigt ihren eigenen Akku-Stand.
- [ ] Detail-Tab: Nach einem Chip-Klick springt die Seite nicht mehr jede Sekunde an den Anfang.
- [ ] Neues Rennen → Format „Runden": das Feld für die Rundenzahl ist erreichbar.
- [ ] Sektor setzen: der Hinweis-Toast erscheint.
- [ ] Fahrer-Ansicht: Fahrzeit, Top-Speed und Streckenzahl stehen da.
- [ ] Die Hz-Anzeige flackert nicht mehr auf 0.
- [ ] **Hardware:** Kart-Einstellungen senden — bei gezogenem USB-Stecker nennt die Meldung den Port, nicht den Funk.
- [ ] **Hardware:** Fünftes Kart anfunken — `bridge_status.kart_mac` bleibt auf einem geführten Kart.

## Self-Review

- [x] Alle sieben Anzeigebefunde haben dieselbe Ursachenfamilie (Redesign entfernt Element, Schreiber bleibt stehen) und sind einzeln gemessen, nicht nur gelesen.
- [x] Firmware-Befunde durch Ausführung belegt: Fuzzing für `_i()`, Limit-Regression für `kart_host`.
- [x] Der Stub verdeckt keine Peer-Verwaltungsfehler.
- [x] Keine Verhaltensänderung für bestehende `bridgeSend`-Aufrufer (`onFail` ist optional).
- [x] Telemetrie bleibt additiv und innerhalb des 250-B-ESP-NOW-Budgets (gemessen: ~200 B).

## Phase Map

- Phase 65 → Live-Tab als Seitenkonzept, vier Fix-Runden
- Phase 66 → Kart-Wahl im Detail-Tab
- **Phase 67 → Anzeigefehler-Audit, Firmware-Absturzpfad, Config-Fehlermeldung**
