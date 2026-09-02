# Phasen 62–64 — Apple-Politur der Oberfläche (Design)

**Auftrag:** Das Programm soll sich hochwertiger anfühlen — nach den Prinzipien aus Apples Design-Vorträgen (vor allem *Designing Fluid Interfaces*, WWDC 2018, und *The Details of UI Typography*, WWDC 2020), übersetzt auf die Web-Plattform.

**Entscheid des Nutzers (2026-09-01): Politur auf dem Bestand.** Die visuelle Identität bleibt — Navy-Grund, Lime-Akzent, Layout, Token-System. Es wird nichts neu erfunden; es wird verfeinert. Alle drei Schichten sind betroffen: Bewegung, Material, Typografie.

**Zweiter Entscheid: „überall gleich".** Bewegung und Materialien gelten auch für Live-Werte und Pit Wall, nicht nur für die Bedien-Oberfläche. Ich hatte Ruhe im Rennen empfohlen (Ablenkung, GPU-Last); der Nutzer hat anders entschieden, das ist gesetzt. **Als Konstruktionsregel bleibt davon:** Zahlen laufen mit Dämpfung 1,0, also **ohne Überschwingen** — ein Messwert steht nie, auch nicht kurz, über dem echten Wert.

## Ist-Zustand (verifiziert, nicht vermutet)

- **Bewegung:** keine Animations-Bibliothek im Projekt (Abhängigkeiten sind serialport, electron-updater, three). ~38 CSS-`transition`-Deklarationen mit fester Dauer, 6 `@keyframes`. `gauges.js` glättet mit festem `LERP = 0.18` am Render-Tick — also bildratenabhängig.
- **Druck-Feedback:** im gesamten CSS existiert genau **eine** `:active`-Regel (`components.css:20`).
- **Tab-Wechsel:** `.tab{display:none;animation:fadeUp .35s ease forwards}` — feste Keyframe-Animation, nicht unterbrechbar, ohne Ausblendung.
- **Material:** vier voneinander unabhängig gewählte Blur-Werte (Topbar 20, `.card-glass` 20, Dialog-Overlay 14, Tabellen-Verlauf 6). Die **Sidebar ist deckend** (`var(--surf)`), die Topbar direkt daneben durchscheinend.
- **Themes:** drei — dark, light, outdoor. `outdoor` macht bereits das Richtige (deckend, 2px-Konturen, `font-weight:600`), aber unsystematisch an Einzelstellen.
- **Barrierefreiheit:** `prefers-reduced-motion`, `prefers-reduced-transparency` und `prefers-contrast` kommen im CSS **kein einziges Mal** vor.
- **Typografie:** 20 verschiedene `letter-spacing`-Werte, 12 verschiedene `line-height`-Werte, jeder einzeln gewählt. Von den geladenen Schnitten (400–800) wird fast ausschließlich 700 benutzt.
- **Schriften:** werden zur Laufzeit von `fonts.googleapis.com` geladen, die CSP erlaubt dafür eigens `fonts.gstatic.com`. Es ist die einzige Stelle, an der das Programm nach außen telefoniert.
- **Schon vorhanden und nicht anzufassen:** `font-variant-numeric: tabular-nums` steht bereits an über einem Dutzend Stellen.

## Locked Decisions

### Bewegung (Phase 62)

- **Eigenes Feder-Modul statt Bibliothek** (Nutzer-Entscheid). Keine vierte Runtime-Abhängigkeit.
- `src/spring.js` — dependency-frei, `node:test`-abgedeckt, im Stil von `geo.js` und `smoothing.js`. Drei pure Funktionen: Feder-Integrationsschritt über `dt` (Zustand = Wert + Geschwindigkeit; Parameter **Dämpfung** und **Response** statt Masse/Steifigkeit), Momentum-Projektion `(v/1000)·d/(1−d)` mit `d = 0.998`, und Rubber-Banding `(overshoot·dim·c)/(dim + c·|overshoot|)` mit `c = 0.55`. Wirft nie.
- `src/motion.js` — DOM-Treiber, **nicht** unit-getestet (Hausregel: DOM-Verdrahtung wird per `node --check` und statischem Grep geprüft). **Eine** `requestAnimationFrame`-Schleife für alle laufenden Federn. Fasst ausschließlich `transform` und `opacity` an.
- **Unterbrechbarkeit ist die Kernanforderung:** bei einem neuen Ziel läuft die Feder vom aktuellen Bildschirmwert **samt aktueller Geschwindigkeit** weiter. Kein Neustart, kein Sprung.
- **Standardwerte:** Dämpfung 1,0 (kritisch gedämpft) überall; Überschwingen (Dämpfung ~0,8) ausschließlich dort, wo der Nutzer selbst Schwung erzeugt hat — also nach einer Wisch- oder Zieh-Geste. Response 0,3–0,4 s für Flächen, **0,2 s für Zahlen**.
- **Druck-Feedback auf `pointerdown`, nicht beim Loslassen.** Buttons, Nav-Einträge, Kart-Chips, Karten und klickbare Tabellenzeilen: `scale(0.97)`, ~100 ms.
- **Tab-Wechsel** wird von `fadeUp` auf die Feder umgestellt, mit Ein- und Ausblendung auf demselben Weg.
- **Dialoge und Overlays** wachsen aus dem auslösenden Element (`transform-origin` am Trigger) und verschwinden dorthin zurück.
- **`gauges.js` verliert `LERP = 0.18`** und benutzt dieselbe `dt`-basierte Feder — das behebt nebenbei die Bildratenabhängigkeit.
- **Nicht bewegt werden Canvas-Inhalte** (Streckenkarte, 3D-Viewer): die haben eigene Schleifen.
- **`prefers-reduced-motion: reduce`** ersetzt jede Feder durch einen 150-ms-Crossfade; Zahlen springen dann sofort.

### Material & Tiefe (Phase 63)

- **Materialgewicht wird ein Token-Satz** in drei Stufen (dünn / normal / dick). Jede Stufe legt Blur, Sättigung, Hintergrund-Deckung und Schattentiefe **gemeinsam** fest. Die vier heutigen Einzelwerte gehen darin auf.
- **Größere Flächen lesen sich als dickeres Material** — stärkerer Blur, tieferer Schatten. Kleine Chips bleiben dünn.
- **Nie eine helle durchscheinende Fläche auf einer anderen.** Das ist eine harte Regel, keine Empfehlung.
- **Die Sidebar wird durchscheinend, als schwerste Stufe** (Nutzer-Entscheid). Dichter als die Topbar, in `dark` und `light` aktiv, in `outdoor` automatisch deckend.
- **Die harte Haarlinie unter der Topbar entfällt.** Stattdessen ein Scroll-Edge-Verlauf, der **nur** erscheint, wenn Inhalt tatsächlich unter die schwebende Leiste wandert. Ebenso für die Statusleiste unten.
- **Dialoge materialisieren:** Blur-Radius und Skalierung laufen gemeinsam an, statt die Fläche nur einzublenden.
- **Schatten kontextabhängig:** tiefer über unruhigem Untergrund (Karte, Tabellen), flacher über ruhigen Flächen.
- **Eine Regel für alle drei Ausstiegspfade:** `outdoor`, `prefers-reduced-transparency: reduce` und `prefers-contrast: more` bekommen dieselbe Behandlung — kein Blur, deckende Flächen, definierte Kontur.

### Typografie (Phase 64)

- **Die Schriften werden mitgeliefert** (Nutzer-Entscheid): DM Sans und JetBrains Mono als `woff2` unter `assets/`, `@font-face` lokal. Die beiden Fremd-Quellen fliegen aus der CSP. Damit ist das Programm offline-fest, die Darstellung reproduzierbar, und die Screenshot-Baselines hängen nicht mehr am Font-Cache des CI-Runners.
- **Tracking und Leading hängen als Paar an der bestehenden `--fs-*`-Skala.** Große Grade: negatives Tracking, enges Leading. Fließtext: Tracking bei null, ruhiges Leading. **Kleine Mono-Versalien der Labels behalten ihr positives Tracking** — dort ist es richtig.
- **Hierarchie stärker über Gewicht**, nicht nur über Größe. Die Schnitte 400–800 sind geladen und werden genutzt.
- **`tabular-nums` wird an die Zahlen-Tokens gezogen**, damit keine neue Stelle es vergisst. Die bestehenden Fundstellen bleiben funktional unverändert.
- **Das CSS-Token-Gate wird um Tracking und Leading erweitert**, analog zu den Skalen aus Phase 50.

## Nicht-Ziele

- **Keine neue visuelle Sprache.** Farben, Layout und Markenauftritt bleiben. Wer das Programm kennt, erkennt es wieder.
- **Keine Bewegung auf Canvas-Inhalten.** Karte und 3D-Viewer behalten ihre eigenen Schleifen.
- **Keine Animations-Bibliothek**, keine vierte Runtime-Abhängigkeit.
- **Kein Umbau der ESP-Seite.** Diese Phasen sind reine Oberfläche.
- **Keine Dynamic-Type-Skalierung.** Eine nutzerseitige Textgrößen-Einstellung ist nicht Teil des Auftrags; die `--fs-*`-Skala bleibt in Pixeln.

## Phasenschnitt

| Phase | Inhalt | Warum in dieser Reihenfolge |
|---|---|---|
| **62** | Bewegung: `spring.js`, `motion.js`, Druck-Feedback, Tab- und Dialog-Übergänge, `gauges.js`-Umstellung, `prefers-reduced-motion` | Fast alles davon ist im Standbild unsichtbar — die Screenshot-Baselines bleiben mit hoher Wahrscheinlichkeit unberührt. Der risikoärmste Einstieg. |
| **63** | Material & Tiefe: Material-Tokens, durchscheinende Sidebar, Scroll-Edge, kontextabhängige Schatten, `outdoor`/`reduced-transparency`/`contrast` | Baut auf der Bewegungsschicht auf (Dialoge materialisieren = Blur + Skalierung gemeinsam gefedert). Erster Baseline-Refreeze. |
| **64** | Typografie: Schriften mitliefern, Tracking-/Leading-Tokens, Gewichtshierarchie, Gate-Erweiterung | Zuletzt, weil das Mitliefern der Schriften die Baselines ohnehin einmal bewegt — dann direkt zusammen mit den Tracking-Änderungen, statt zweimal. |

## Verifikation

- `npm test` wächst um die `spring.js`-Abdeckung (Feder-Konvergenz, Unterbrechung mit Geschwindigkeitsübergabe, Projektion, Rubber-Banding, ungültige Eingaben).
- `npm run lint`, `npm run lint:css` bleiben bei 0 bzw. OK; das CSS-Gate wächst in Phase 63 um die Material-Tokens und in Phase 64 um Tracking/Leading.
- `node --check` für die neuen Module und alle berührten DOM-Dateien.
- Python bleibt unberührt (keine ESP-Änderung).
- Lokale e2e-Funktionstests müssen grün bleiben — insbesondere, dass Druck-Feedback auf `pointerdown` die bestehenden Klick-Tests nicht bricht.

### Offene Konsequenz: Screenshot-Baselines

Phase 62 sollte die Baselines nicht bewegen (Bewegung ist im Standbild unsichtbar) — falls doch, ist das ein Hinweis auf einen unbeabsichtigten Layout-Effekt und wird untersucht, **nicht** weggefroren. Die Phasen 63 und 64 verändern sie zwangsläufig. Für jeden Refreeze gilt die bestehende Regel: aus dem CI-Lauf (Linux), jeder Diff auf eine benannte Ursache zurückgeführt, Freigabe durch den Nutzer.

### Manuelle Abnahme (Nutzer, nicht automatisierbar)

- Bewegung fühlt sich am echten Gerät flüssig an, nicht träge — besonders schnelles Hin- und Herschalten zwischen Tabs.
- Live-Werte bleiben im Fahren ablesbar; kein Wert steht sichtbar über dem echten Wert.
- `outdoor`-Theme bei Sonne: keine durchscheinenden Flächen, Text bleibt lesbar.
- Die mitgelieferten Schriften erscheinen auch ohne Internetverbindung.
