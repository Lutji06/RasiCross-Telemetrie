# Phase 61 — Geglättete Max-Werte + Restarbeiten aus Phase 60

**Goal:** Die angezeigten Maximalwerte von Geschwindigkeit und Drehzahl dürfen nicht mehr von einem einzelnen Störimpuls gesetzt werden. Dazu die beiden aus Phase 60 offen gebliebenen Punkte abräumen: die tote `k.batt.cells` (Befund 4) und das Neu-Einfrieren der Screenshot-Baselines.

**Architecture:** `processTelemetry` schrieb `k.max`, `k.currentLapMax`, `k.heatmap.lapMaxSpeed` und den Lebens-Topspeed direkt aus den Rohwerten des Pakets — ein GPS-Ausreißer oder eine Zünd-EMI-Flanke am Hall-Sensor setzte den MAX-Wert damit dauerhaft. Neu läuft ein exponentieller Mittelwert (EMA) als eigenes, testbares Modul mit, aus dem sich alle angezeigten Maxima speisen. Die Rohwerte bleiben unangetastet: Charts, Drift-Erkennung und die Zeiger der Anzeigen zeigen weiter das ungefilterte Signal.

**Branch:** `feat/phase-61-geglaettete-maxwerte`, aufgesetzt auf `feat/phase-60-sektor-bests-pro-rennen` (PR #95).

## Locked Decisions

- **Nur die Maxima werden geglättet.** Rohwerte bleiben in `k.raw`/`k.telemetry`. Sichtbare Folge, bewusst akzeptiert: während eines Spikes kann der Zeiger kurz über dem MAX-Wert stehen. Auch die Live-Anzeige zu glätten war nicht verlangt und hätte die Hauptanzeige träger gemacht.
- **alpha = 0,3** bei ~12,5 Hz Paketrate: ein einzelner Ausreißer schlägt zu 30 % durch, ein echter Anstieg ist nach ~0,4 s praktisch erreicht.
- **Der erste Messwert seedet die EMA direkt** (`prev == null`), damit der MAX-Wert nicht aus einer Rampe ab 0 hochläuft. Deshalb starten `display.speedLerp`/`rpmLerp` auf `null` statt `0`.
- **Die vorhandenen `display.speedLerp`/`rpmLerp` werden benutzt**, nicht ein neues Feld: sie existierten, wurden aber nirgends gelesen. `gxLerp`/`gyLerp` bleiben bei `0` — `gauges.js` lerpt sie selbst.
- **Der Lebens-Topspeed (`stats.topKmh`) zählt als angezeigtes Maximum** und bekommt ebenfalls die geglättete Quelle. Der Odometer ändert sich dadurch praktisch nicht, weil die EMA den Mittelwert erhält.
- **`k.max.g` bleibt roh** — die G-Spitze ist ein Stoßereignis, kein zu glättender Verlauf.
- **`k.batt.cells` fliegt ersatzlos raus** (Befund 4 aus dem Phase-59-Audit): an drei Stellen geschrieben, nirgends gelesen — die Zellenspannung rechnet der ESP. Der Registry-Default `3` widersprach zudem dem ESP-Default `1`. Das Konfigurationsfeld `espBattCells` bleibt unverändert und geht weiter als `batt_cells` an den Sender.
- **Baselines werden aus dem CI-Lauf eingefroren**, nie aus einem lokalen Lauf (Font-Rendering ist plattformabhängig; lokale `*-win32.png` sind gitignored).

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/smoothing.js` | pures EMA-Modul (`MAX_ALPHA`, `emaStep`) |
| Create | `test/smoothing.test.js` | node:test-Abdeckung des Moduls |
| Modify | `src/telemetry.js` | EMA mitführen; alle Maxima aus dem geglätteten Verlauf |
| Modify | `src/kart-registry.js` | `speedLerp`/`rpmLerp` auf `null`; `batt.cells` weg |
| Modify | `src/recording.js` | `resetReplayDerived`: gleiche Defaults wie die Registry |
| Modify | `src/esp-config.js` | `batt.cells` aus dem `config_ack`-Pfad |
| Modify | `src/kart-settings-window.js` | `batt.cells` beim Senden nicht mehr spiegeln |
| Modify | `e2e/screens.spec.js-snapshots/*-linux.png` | vier Baselines neu, eine erstmals eingefroren |

Reihenfolge: 1 → 2 → 3 (sequenziell, je Task ein Commit).

## Task 1 — Geglättete Max-Werte (TDD)

- [x] `test/smoothing.test.js` zuerst: Export-Form, erster Wert seedet unverändert, Spike-Dämpfung, Konvergenz gegen einen konstanten Eingang, ungültige Eingaben (`NaN`, `null`, Alpha außerhalb `(0,1]`) ändern den Zustand nicht. Lauf muss rot sein.
- [x] `src/smoothing.js` anlegen: dependency-freies ESM-Objektmodul (Konvention Phase 42, Stil wie `kart-stats.js`), `MAX_ALPHA = 0.3`, `emaStep(prev, value, alpha)`. Wirft nie; `alpha` ist das Gewicht des **neuen** Werts (wie `gauges.js` LERP und `calc.rpm_ema_step` auf dem ESP).
- [x] `src/telemetry.js`: `RasiSmoothing` importieren; in `processTelemetry` nach `speed`/`rpm` die EMA fortschreiben und `speedSm`/`rpmSm` bilden.
- [x] Alle angezeigten Maxima auf `speedSm`/`rpmSm` umstellen: `k.max.speed/rpm`, `k.currentLapMax.speed/rpm`, `k.heatmap.lapMaxSpeed`, `statsStep(...)` (Lebens-Topspeed). `k.max.g` und die Chart-Pushes bleiben roh.
- [x] `src/kart-registry.js` + `src/recording.js`: `speedLerp`/`rpmLerp` auf `null` (beide Stellen identisch halten).
- [x] Verify: `npm test`, `npm run lint`.
- [x] Commit: `feat(live): angezeigte Max-Werte von Speed und RPM aus geglaettetem Verlauf (Phase 61)`

## Task 2 — Tote `batt.cells` entfernen (Befund 4 aus Phase 59)

- [x] `src/kart-registry.js`: `cells: 3` aus dem `batt`-Default; `src/recording.js`: gleiche Zeile in `resetReplayDerived`.
- [x] `src/esp-config.js`: `cells` nicht mehr aus dem `config_ack` übernehmen.
- [x] `src/kart-settings-window.js`: `cells` beim Senden nicht mehr in den Kart-State spiegeln. `espBattCells` (Konfigurationsfeld) bleibt unangetastet.
- [x] Verify: Grep `batt\.cells|cells:` über `src/` → nur noch `espBattCells`. `npm test`, `npm run lint`.
- [x] Commit: `refactor(kart): tote batt.cells entfernt (Befund 4, Phase 61)`

## Task 3 — Screenshot-Baselines einfrieren + Abschluss

- [x] Branch pushen, CI-Lauf abwarten, `playwright-results`-Artefakt herunterladen (Lauf 33511326665).
- [x] Jeden der fünf Fehlschläge gegen die Quelle belegen, bevor eingefroren wird:
  - `tab-live`, `demo-live-single`: BOX-Button (Boxenruf) und Display-Modus-Dropdown sind in Phase 58 entfallen (`9b4a166`), der Live-Kopf wird eine Zeile kürzer.
  - `tab-settings`: Kategorie „Bildschirm" entfällt (Phase 58), die Kategorienliste rückt nach.
  - `demo-kart-fenster`: Fensterbreite 460 → 520 (Phase 59).
  - `demo-connection`: seit Phase 56b fehlende Baseline (`A snapshot doesn't exist`), erstmals eingefroren.
- [x] `*-actual.png` aus dem Artefakt als `*-linux.png` übernehmen (keine lokalen Läufe).
- [x] Commit: `test(e2e): Screenshot-Baselines auf Stand der Phasen 58-61 eingefroren (Phase 61)`
- [x] Volle Gates: `npm test` (229), `npm run lint` (0), `npm run lint:css` (OK), `node --check` (geo/replay/main/preload/tiles), `python -m unittest discover -s test -p "test_*.py"` (64 OK), lokale e2e 12/12. `__pycache__` löschen.
- [x] `graphify update .` (nicht committen).
- [x] Commit Code-Politur + Plan-Doc.

## Manuelle Abnahme (User, deferred)

- [ ] Rennen fahren: der MAX-Wert von Speed/RPM springt nicht mehr auf einen einzelnen Ausreißer.
- [ ] Gegenprobe: der Zeiger der Live-Anzeige reagiert unverändert schnell (nur die Maxima sind geglättet).
- [ ] Rundentabelle: die Rundenmaxima wirken plausibel, nicht zu niedrig.
- [ ] Kart-Fenster: Batteriewerte unverändert korrekt (Zellenzahl geht weiter als `batt_cells` an den Sender).
- [ ] Offen aus Phase 60: Sektorfärbung in der Pit Wall, Replay lässt Bestzeiten unberührt.

## Self-Review

- [x] Anforderung „angezeigte Max-Werte geglättet" deckt alle vier Senken ab: Live/Pit-Wall-Kacheln (`k.max`), Rundentabelle (`k.currentLapMax`), Heatmap-Skala (`heatmap.lapMaxSpeed`), Lebens-Topspeed (`stats.topKmh`).
- [x] Keine Platzhalter; `smoothing.js` ist dependency-frei und wirft nie (ungültige Eingaben geben den Vorzustand zurück).
- [x] `speedLerp`/`rpmLerp`-Defaults an beiden Stellen (Registry + Replay-Reset) identisch — sonst käme nach einem Replay eine Rampe ab 0.
- [x] Baselines nur aus dem CI-Lauf, jeder Diff auf einen benannten Commit zurückgeführt.

## Phase Map

- Phase 58 → ESP-Bildschirm-Funktion entfernt (PR #93)
- Phase 59 → Multikart-Bugfixes, Audit mit Befunden 1–4 (PR #94)
- Phase 60 → Befunde 1–3, Sektor-Bests pro Rennen (PR #95)
- **Phase 61 → geglättete Max-Werte, Befund 4, Baseline-Freeze**
