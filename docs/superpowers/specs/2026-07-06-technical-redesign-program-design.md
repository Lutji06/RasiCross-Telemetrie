# Technisches Redesign-Programm (Phasen 41–45) — Design

**Datum:** 2026-07-06
**Status:** Entwurf zur Review
**Umfang:** Strukturelles Redesign von Dashboard (Vite/ESM, State-Modell, Modul-Zerlegung) und Firmware (sender.py-Modularisierung). Rein technisch — keine Features, keine UI/UX-Änderungen.

## Motivation

Drei strukturelle Schwächen erzeugen wiederkehrende Reibung bei jeder neuen Phase:

1. **Implizite Global-Kopplung:** 26 klassische `<script>`-Tags in fester Reihenfolge in `RasiCross_Telemetry.html`; ~129 manuell in `eslint.config.js` gepflegte window-Globals bilden das faktische "Modulsystem". Abhängigkeiten sind unsichtbar, die Ladereihenfolge ist fragil.
2. **Doppelte State-Repräsentation:** Die Aktiv-Kart-Fassade (`state.lapStart`, `state.liveDelta`, `state.sectorsLive`, …) muss bei jedem Kart-Wechsel mit den per-Kart-Buckets (`state.karts`) synchronisiert werden. Fassaden-Drift war Bug-Quelle mehrerer Phasen; Phase 40 musste explizit um sie herumarbeiten.
3. **Zwei Großdateien:** `rasicross.js` (1658 Zeilen, trotz Split in Phase 22/23 wieder gewachsen) und `sender.py` (1533 Zeilen Firmware-Monolith).

Die pure Logik ist gut getestet (177 node:test-Tests: geo, lap-engine, calc); die UI-Schicht hat kein automatisches Netz.

## Zielarchitektur Dashboard

### Modulsystem

- Alle App-Scripts werden ES-Module unter `src/` mit expliziten `import`/`export`.
- **Vite** als Dev-Server (`npm run dev`, HMR) und Builder (`vite build` → `dist/`); electron-builder paketiert `dist/` statt loser Dateien.
- `vendor/three.min.js` und `vendor/three.gltf-loader.min.js` entfallen; three.js kommt als npm-Paket, Tree-Shaking reduziert auf den von `karts3d.js` genutzten Umfang.
- Die manuell gepflegten ESLint-Global-Listen entfallen; ESLint prüft echte Imports.
- `main.js`/Preload bleiben CommonJS; nur der Renderer wird ESM. Dev lädt `http://localhost:5173`, Prod lädt `dist/index.html`.

### Schichtung (Abhängigkeiten nur von oben nach unten)

| Schicht | Module | Regel |
|---|---|---|
| Pure Logik | `geo`, `lap-engine`, `drift`, `attitude`, `engine`, `kart-rank` | kein DOM, kein State |
| State | `store` (neu), `kart-registry`, `rec-store` | kein DOM |
| Dienste | `serial`, `demo`, `recording`, `replay`, `tiles` | State lesen/schreiben, kein DOM-Rendering |
| UI | `live-ui`, `pit-wall`, `track`, `races-ui`, `gauges`, `map-draw`, `karts3d`, … | rendern aus State, keine Geschäftslogik |

### State-Modell (Kern des Redesigns)

- Die per-Kart-Buckets (`state.karts`) werden die **einzige Quelle der Wahrheit**.
- Die Aktiv-Kart-Fassade wird ersetzt durch einen Selektor `activeKart()`, der den Bucket des aktiven Karts zurückgibt. UI-Code liest `activeKart().lapStart` statt `state.lapStart`.
- Kein Kopieren, keine Synchronisation bei Kart-Wechsel, kein Drift möglich; die Sync-Codepfade (Kart-Wechsel-Kopien) werden gelöscht.
- Persistenz bleibt formatstabil: `SAVE_KEY`- und `REC_VERSION`-Formate ändern sich nicht (Laufzeitstruktur ≠ Speicherformat).

## Phasenplan mit Verifikationsgates

Fünf Phasen, jede einzeln mergebar (eigener PR gegen `main`), jede mit hartem Gate:

### Phase 41 — Test-Sicherheitsnetz

UI-Smoke-Tests auf Basis von **Playwright** (echte devDependency; der vorhandene Pit-Wall-E2E-Treiber wird darauf umgezogen bzw. eingebunden). Abgedeckt:

- App startet (Electron lädt, keine Konsolen-Fehler)
- alle Tabs rendern
- Demo-Modus erzeugt 3 Karts mit laufenden Rundenzeiten
- Rennen starten/stoppen funktioniert
- `buildRaceDataForKart` liefert pro Kart plausible Payloads
- Recording/Replay-Roundtrip läuft

Bewusst Smoke-Tiefe, keine Pixel-Prüfung.
**Gate:** Smoke-Suite läuft in CI (GitHub Actions, headless) und lokal unter Windows.

### Phase 42 — Vite + ESM-Migration

Mechanische Migration in fester Reihenfolge entlang der Schichtung: pure Logik → State → Dienste → UI → Einstiegspunkt. Pro Datei: `export` ergänzen, Konsumenten auf `import` umstellen, Global aus `eslint.config.js` streichen. three.js von `vendor/` auf npm.
**Gate:** Smoke-Suite grün, `node --test` grün (Tests importieren ESM statt UMD-require), gebaute Portable-EXE startet und verbindet sich mit der Bridge.

### Phase 43 — State-Redesign

Fassade raus, `activeKart()`-Selektor rein. Mechanik: Fassadenfelder einzeln entfernen, Lesestellen auf Selektor umstellen, Sync-Codepfade löschen.
**Gate:** Smoke-Suite grün + neuer gezielter Test: Kart-Wechsel während laufendem Rennen ändert keine Bucket-Daten.

### Phase 44 — rasicross.js zerlegen

Aufteilung entlang der heutigen Abschnitte: `store.js` (State + Persistenz), `telemetry.js` (processTelemetry-Pipeline inkl. Recording-Hooks), `esp-config.js` (Config-ACK-Handling), `app-init.js` (Bindings, 1-Hz-Loop, Boot). Danach keine App-Datei über ~500 Zeilen.
**Gate:** Smoke grün + Diff-Review: nur Code bewegt, nicht geändert.

### Phase 45 — Firmware-Modularisierung

`sender.py` wird entlang bestehender Verantwortungen in `esp_libs/`-Module gezogen (`gps_task`, `imu_task`, `display_pages`, `radio`, `config_store`); `sender.py` bleibt dünner Orchestrator. mpy-cross-Flash-Prozedur (app.mpy + Stub) unverändert; `gc.mem_free()` wird nach Boot geloggt.
**Gate:** Beide echte Karts geflasht; Telemetrie, OLED und Pit-Call auf der Wiese verifiziert. Vorher wird nichts gemerged.

### Reihenfolge-Logik

Das Netz (41) sichert alles Folgende. Vite (42) vor State-Redesign (43), weil explizite Imports die Umstellung der Lesestellen mechanisch prüfbar machen. Die Zerlegung (44) ist nach 43 fast risikofrei. Firmware (45) zuletzt und unabhängig — kann geschoben werden, ohne dass 41–44 an Wert verlieren.

## Kompatibilitätsgarantien

- **Datenformate:** `SAVE_KEY`-localStorage-Format, `REC_VERSION`-Aufzeichnungen und das serielle JSON-Protokoll zur Bridge bleiben byte-kompatibel. Alte Recordings bleiben abspielbar (Replay-Roundtrip-Test aus Phase 41).
- **Funk-Protokoll:** ESP-NOW-Payloads, `_ACK_KEYS`-Kompaktkeys, 250-B-Budget unberührt. Phase 45 verschiebt Code, ändert kein Paketfeld.
- **Versionierung:** App-Version folgt weiter GitHub-Release-Tags (1.0.x); Datenformat-Versionen bleiben entkoppelt.

## Risiken & Gegenmittel

1. **Vite×Electron-Integration** (Phase 42, größtes Risiko): Serialport bleibt im Main-Process (CommonJS, unangetastet); Renderer redet über den Preload-Bridge. Fallback bei HMR-Problemen: nur `vite build` nutzen, Dev ohne HMR.
2. **Ladereihenfolge-Altlasten:** ESM macht stille Init-Reihenfolgen und Zyklen sichtbar. Jeder Zyklus wird aufgelöst (meist: Konstante in eigenes Modul), nicht per Re-Export versteckt.
3. **ESP32-RAM** (Phase 45): Mehr Module = mehr Import-Overhead. Gegenmittel: mpy-cross-kompiliert flashen, `gc.mem_free()` loggen. Abbruchkriterium: Vor Phase 45 wird der freie Heap nach Boot als Baseline gemessen; fällt er durch die Modularisierung mehr als 10 % unter diese Baseline, werden Module wieder zusammengelegt statt weiter gesplittet.
4. **Lange Branches:** Jede Phase eigener PR; Feature-Arbeit kann jederzeit dazwischen (deshalb kein Big-Bang).

## Rollback

Jede Phase ist per `git revert` des Merge-Commits rückrollbar, da keine Phase Datenformate migriert. Nach Phase 42 existiert `vendor/` nicht mehr — der Revert des Merge-Commits stellt den Vendor-Ordner wieder her.

## Nicht-Ziele

- Keine neuen Features, keine UI/UX-Änderungen — rein strukturell.
- Kein Laufzeit-Framework (React/Vue/…): UI bleibt Vanilla-DOM; Vite ist nur Build-Werkzeug.
- Keine TypeScript-Migration (eigenes späteres Vorhaben, setzt auf den ESM-Grenzen auf).
- bridge.py bleibt unangetastet (stabilste Komponente).

## Verworfene Alternativen

- **Ohne Build bleiben / ESM ohne Bundler:** verworfen zugunsten des vollen Vite-Builds (Entscheidung User, 2026-07-06). Native ESM ohne Bundler hätte file://-CORS-Probleme; das Script-Modell konserviert die Global-Kopplung.
- **Vite zuerst, Tests danach (Ansatz B):** riskanteste Migration ohne UI-Netz.
- **Big-Bang auf einem Branch (Ansatz C):** wochenlang nicht mergebar, Review unmöglich.

## Phase Map

- Phasen 22/23: erster rasicross.js-Split — merged.
- Phase 39: Multikart-Verbesserungen — merged.
- Phase 40: per-Kart-OLED-Routing — merged (PR #62); Hardware-Abnahme offen.
- **Phasen 41–45: dieses Programm.** Jede Phase bekommt eine eigene Implementierungs-Planung (writing-plans) vor Ausführung.
