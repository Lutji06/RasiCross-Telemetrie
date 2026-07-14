# Modernisierungs-Programm (Phasen 49–54) — Design

**Datum:** 2026-07-14
**Status:** Entwurf zur Review
**Umfang:** UI-Konsistenz auf Basis eines CSS/Design-Systems, TypeScript-Migration von `src/`, Test-Vertiefung (Playwright-Flows, pytest für bridge.py), Langzeit-Session-Performance. Kein Stilwechsel, keine Features.

## Motivation

Das technische Redesign (Phasen 41–45: Vite/ESM, State-Modell, Modul-Zerlegung, Firmware-Modularisierung) ist abgeschlossen. Vier verbliebene Baustellen erzeugen weiter Reibung:

1. **CSS-Monolith:** ~2.380 Zeilen CSS als `<style>`-Block in index.html (Zeilen 11–2392 von 3.532). Es existiert ein Token-Fundament (84 Custom-Properties, 783 `var()`-Nutzungen), aber 112 rohe Hex-Farben umgehen es; Buttons, Panels und Abstände sind über die Tabs hinweg uneinheitlich gewachsen.
2. **Keine Typsicherheit:** `src/` umfasst 38 ESM-Dateien (~8.500 Zeilen) ohne Typen. Die zentralen Verträge (Telemetriepaket, KartState-Bucket) sind nur implizit definiert. Die TypeScript-Migration war in der 41–45-Spec explizit als späteres Vorhaben notiert.
3. **Testlücken:** Playwright deckt nur Smoke-Tiefe ab; bridge.py (Python) hat gar keine Tests.
4. **Langzeit-Verdacht:** Nach mehrstündigen Renntag-Sessions wird die App gefühlt träger; es gibt weder Messung noch Budget.

## Programmüberblick

Sechs Phasen, jede einzeln mergebar (eigener PR gegen `main`), jede mit hartem Verifikationsgate — dasselbe Muster wie 41–45.

| Phase | Inhalt | Sichtbares Ergebnis |
|---|---|---|
| 49 | CSS-Extraktion + Token-Vervollständigung + Screenshot-Baseline | keins (pixel-neutral) |
| 50 | UI-Konsistenz-Pass über alle Tabs | ja — vereinheitlichtes UI |
| 51 | Test-Vertiefung (Playwright-Flows, pytest für bridge.py) | keins |
| 52 | TypeScript: pure Logik + State | keins |
| 53 | TypeScript: Dienste + UI | keins |
| 54 | Performance: Langzeit-Session (Soak, Leaks, Budgets) | stabilere Renntage |

**Ziele:**

- Einheitliches, wartbares UI ohne Stilwechsel — der heutige Look bleibt erkennbar (Entscheidung User: „Konsistenz statt Neuanstrich").
- Typsicherheit über ganz `src/` mit `strict: true`.
- Belegtes Vertrauen, dass ein voller Renntag ohne Degradation läuft.

## Phase 49 — CSS-Extraktion, Tokens, Screenshot-Baseline (pixel-neutral)

Der `<style>`-Block wandert aus index.html in Dateien unter `src/styles/`, die Vite nativ bündelt:

```
src/styles/
  index.css         # fasst alles per @import in heutiger Quelltext-Reihenfolge
  tokens.css        # :root-Custom-Properties (heute 84, werden vervollständigt)
  base.css          # Reset, Typografie, Grundlayout, Tabs
  components.css    # Buttons, Panels, Formulare, Dialoge, Toasts, Badges
  pages/
    live.css  pitwall.css  karts.css  races.css  settings.css  map.css
```

Eingebunden per einem `import './styles/index.css'` im Renderer-Einstieg. Die Regel-Reihenfolge bleibt exakt die heutige Quelltext-Reihenfolge — dadurch ändert sich keine Spezifität-Auflösung.

**Token-Vervollständigung:** Die 112 rohen Hex-Farben werden inventarisiert. Entspricht eine exakt einem bestehenden Token, wird sie durch `var(--…)` ersetzt; echte Solitäre bekommen neue Tokens. Keine Farbe ändert ihren Wert — nur ihre Schreibweise. Ein Lint-Gate (CI-Skript: kein Hex außerhalb von tokens.css) erzwingt das dauerhaft.

**Screenshot-Baseline:** Vor der Extraktion — noch auf dem alten Stand — entsteht die Baseline: Playwright `toHaveScreenshot()` pro Tab im Demo-Modus, plus Kart-Fenster und die wichtigsten Dialoge. Dynamische Regionen (Rundenzeiten, Karte, 3D) werden per `mask:` ausgeblendet, Animationen deaktiviert.

**Gate:** Alle Screenshots identisch zur Baseline (Beweis der Pixel-Neutralität), Smoke-Suite + `npm test` grün, index.html enthält kein `<style>` mehr, Hex-Lint grün.

## Phase 50 — UI-Konsistenz-Pass

Zuerst eine Inventur: Wie viele Button-Varianten, Panel-Rahmen, Abstands- und Schriftgrößen-Werte existieren real? Daraus wird ein Soll definiert (z. B. eine Spacing-Skala, zwei Button-Typen, ein Panel-Stil) — als Erweiterung von tokens.css, im heutigen Look. Dann tab-für-tab vereinheitlichen, ein Commit pro Tab, damit jeder Screenshot-Diff einzeln reviewbar ist.

**Gate:** Smoke + Unit-Tests grün; jeder Screenshot-Diff ist eine beabsichtigte, vom User pro Tab freigegebene Änderung; danach wird die Baseline neu eingefroren.

## Phase 51 — Test-Vertiefung

1. **Playwright-Flows** (heute: Smoke-Tiefe). Neu als echte Sequenzen:
   - Rennen-Lebenszyklus: starten → Runden laufen im Demo-Modus auf → beenden → Ergebnis erscheint im Races-Tab.
   - Recording → Replay-Roundtrip über die UI (nicht nur API).
   - Einstellungen ändern → App-Reload → Werte persistent (SAVE_KEY-Pfad durch die echte UI).
   - Multi-Kart: Leaderboard-Reihenfolge reagiert auf Demo-Daten.
2. **pytest für bridge.py** — erstmals Tests für die Python-Seite, ohne bridge.py umzubauen: Frame-Parsing und JSON-Konvertierung gegen aufgezeichnete Fixture-Pakete (echte Mitschnitte von der Wiese). Was sich ohne Refactoring nicht testen lässt, bleibt draußen — bridge.py bleibt unangetastet.

**Gate:** Neue Suiten laufen in CI (GitHub Actions) und lokal unter Windows; keine Flaky-Retries nötig (deterministische Waits, keine sleeps).

## Phase 52 — TypeScript: pure Logik + State

- Setup einmalig: `typescript` als devDependency, striktes `tsconfig.json` (`strict: true`, `allowJs: true` für die Übergangszeit). Vite transpiliert TS nativ — am Build ändert sich nichts. Typprüfung als eigenes CI-Gate: `tsc --noEmit`. node:test-Suiten laufen über Nodes natives Type-Stripping; Fallback `tsx`, falls die CI-Node-Version es nicht kann (kurzer Spike beim Phasen-Plan).
- Zuerst entsteht `src/types.ts` mit den zentralen Verträgen: Telemetriepaket, KartState (Registry-Bucket mit allen Untersparten: cal, engine, stats, connection, replay, …), Race-/Lap-Strukturen. Das ist der eigentliche Gewinn — diese Strukturen sind heute nur implizit definiert.
- Dann Umbenennung `.js → .ts` von unten nach oben entlang der 41–45-Schichtung: pure Logik (geo, lap-engine, drift, attitude, engine, kart-rank, kart-stats, …), danach State (store, kart-registry, rec-store). Pro Datei: umbenennen, Typen ergänzen, keine Logikänderung.

**Gate:** `tsc --noEmit` strikt grün, alle Unit-Tests + Smoke grün, gebaute EXE startet.

## Phase 53 — TypeScript: Dienste + UI

Der Rest von `src/`: Dienste (serial-demo, recording, replay, tiles), dann UI-Module (live-ui, pit-wall, karts-page, kart-settings-window, …). Für die DOM-lastige UI-Schicht gibt es typisierte Helfer (`$()` mit Generics statt `any`), damit strict auch dort hält. `main.js` und Preload bleiben bewusst CommonJS-JavaScript — Electron-Main ist klein, stabil und außerhalb des Scopes.

**Gate:** Kein `.js` mehr unter `src/`, `tsc --noEmit` strikt grün ohne `allowJs`, volle Gates (Unit, Smoke, Screenshots, EXE).

## Phase 54 — Langzeit-Session-Performance

Erst messen, dann fixen:

1. **Soak-Test:** Mehrstündiger Demo-Lauf (3 Karts, laufendes Rennen) in der echten Electron-App, automatisiert per Playwright. Alle paar Minuten werden Heap-Größe, DOM-Knoten-Zahl und Event-Listener-Zahl protokolliert; am Anfang und Ende je ein Heap-Snapshot.
2. **Verdächtige** (gezielt geprüft, nicht blind umgebaut): unbegrenzt wachsende Arrays (Runden-Historie, Track-/Trail-Punkte, Recording-Puffer), nicht abgeräumte Listener beim Tab-/Kart-Wechsel, Allokationen in der 1-Hz-Schleife.
3. **Fixes nur auf Beweis:** Was der Snapshot-Diff als Wachstum zeigt, bekommt eine Obergrenze (Ringpuffer/Caps) oder ein Cleanup. Nichts wird vorsorglich optimiert.
4. **Budgets in CI:** Ein verkürzter Soak (~10 Min beschleunigter Demo-Modus) läuft als Nightly-Workflow und schlägt fehl, wenn der Heap nach Warmup mehr als ein definiertes Budget wächst. Der volle Mehrstunden-Soak bleibt ein manueller Lauf vor Releases.

**Gate:** Soak-Protokoll dokumentiert (Vorher/Nachher), Nightly-Budget grün, Smoke grün; endgültige Bestätigung am nächsten langen Renntag.

## Reihenfolge-Logik

Baseline (49) vor jeder sichtbaren Änderung; Konsistenz (50) direkt auf den frischen Tokens; Tests (51) vor TypeScript, damit die Migration ein Netz hat; TypeScript (52/53) vor Performance (54), damit Perf-Umbauten typgeprüft laufen. Jede Phase hat für sich Wert — das Programm kann nach jeder Phase pausieren, ohne Torso zu hinterlassen.

## Kompatibilitätsgarantien

- **Datenformate:** `SAVE_KEY`-localStorage-Format, `REC_VERSION`-Aufzeichnungen und das serielle JSON-Protokoll zur Bridge bleiben byte-kompatibel.
- **Funk-Protokoll:** ESP-NOW-Payloads und Kompaktkeys unberührt; Firmware (`sender.py`/esp_libs) wird nicht angefasst.
- **Versionierung:** App-Version folgt weiter GitHub-Release-Tags (1.0.x); Datenformat-Versionen bleiben entkoppelt.

## Risiken & Gegenmittel

1. **Screenshot-Flakiness** (größtes Risiko): Font-Rendering unterscheidet sich zwischen Windows lokal und Linux-CI. Gegenmittel: CI ist die einzige Wahrheit für Screenshot-Vergleiche (Baseline wird in CI erzeugt), lokal optional; dynamische Regionen maskiert, Animationen aus.
2. **Kaskaden-Drift bei CSS-Extraktion:** Regel-Reihenfolge bleibt 1:1 erhalten; das Screenshot-Gate beweist Neutralität.
3. **TS-strict deckt echte Bugs auf:** Wahrscheinlich — jeder Fund wird als eigener kleiner Fix-Commit dokumentiert, nicht stillschweigend mitgeändert. `any` nur mit `// TODO(ts)`-Marker; die Zählung darf pro Phase nur sinken.
4. **Node-Type-Stripping in CI/lokal inkompatibel:** Fallback `tsx` eingeplant; Entscheidung per kurzem Spike beim Phase-52-Plan.
5. **Programm blockiert Feature-Arbeit:** Nein — jede Phase einzeln mergebar, Features können jederzeit dazwischen.

## Rollback

Jede Phase ist per `git revert` des Merge-Commits rückrollbar, da keine Phase Datenformate migriert. Nach Phase 49 existiert der `<style>`-Block nicht mehr — der Revert stellt ihn wieder her. Nach Phase 52/53 sind Dateien umbenannt — der Revert stellt die `.js`-Fassung wieder her.

## Nicht-Ziele

- Kein Stilwechsel: Der heutige Look bleibt erkennbar; nur Vereinheitlichung.
- Keine neuen Features, kein Laufzeit-Framework — UI bleibt Vanilla-DOM.
- Kein Umbau von bridge.py (nur Tests) und keine Firmware-Änderungen.
- Keine TypeScript-Migration von `main.js`/Preload (Electron-Main bleibt CommonJS-JS).

## Verworfene Alternativen

- **TypeScript zuerst (Ansatz B):** Wochenlang kein sichtbares Ergebnis; TS-Migration der UI-Schicht ohne visuelles Regressionsnetz riskanter.
- **Zwei parallele Stränge (Ansatz C):** Stacked-PR-Reibung (siehe Phase 46, #67/#68) ohne echten Zeitgewinn im Solo-Projekt.

## Phase Map

- Phasen 41–45: Technisches Redesign-Programm (Vite/ESM, State, Split, Firmware) — merged.
- Phasen 46–48: Kart-Detailseite, Kart-Einstellungen, Kart-Fenster + Lebens-Statistik — merged (zuletzt PR #75).
- **Phasen 49–54: dieses Programm.** Jede Phase bekommt eine eigene Implementierungs-Planung (writing-plans) vor Ausführung.
