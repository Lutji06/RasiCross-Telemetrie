# Phase 56b: Verbindungsseite Feinschliff — Design

**Datum:** 2026-07-18 · **Status:** vom User freigegeben (Visual-Companion-Session: Kopfbereich B, Kart-Karten B, Ruhezustand A einzeln bestätigt, Gesamtbild mit „passt" freigegeben)
**Basis:** Branch `feat/phase-56-verbindungsseite` (PR #79, noch nicht gemerged) — baut direkt auf der Phase-56-Umsetzung auf; die Screenshot-Baselines von Phase 56 sind noch nicht eingefroren, es entsteht also kein doppelter Freigabe-Loop.

## Ziel

Die in Phase 56 neu gebaute Verbindungsseite wird optisch fertiggestellt: zwei Layout-Bugs (Hero-Clipping, Button-Überlauf) verschwinden strukturell, der Kopfbereich wird zum „Verbinden-Cockpit", die Kart-Karten bekommen eine klare Lesereihenfolge, und der Ruhezustand erklärt sich selbst statt leer zu wirken.

## Ist-Probleme (verifiziert per Screenshot, 2026-07-18)

1. **Bug:** Der pw-Hero clippt seinen Inhalt oben, sobald die Portstatus-Zeile plus Aktions-Buttons die feste Hero-Höhe sprengen (Demo-Zustand: Eyebrow und Kachel-Oberkanten abgeschnitten).
2. **Bug:** Drei Kacheln + drei Buttons passen nicht in die Hero-Zeile — der „Details"-Button läuft rechts aus dem Bild.
3. Der inaktive „Verbinden"-Button leuchtet während der Demo weiter grün (sieht klickbar aus).
4. Kart-Karten ohne Hierarchie: Name vertikal mittig links, Werte als unregelmäßig umbrechendes Flex-Raster, „Diagnose ▸" schwebt frei rechts.
5. Ruhezustand wirkt leer: kleine graue Platzhalter-Karte, darunter dominiert die sekundäre „Aufnahme & Replay"-Karte mit leuchtendem Primär-Button.

## Locked Decisions (User, 2026-07-18)

1. **Kopfbereich B — Verbinden-Cockpit links im Hero:** Links untereinander Eyebrow → Portstatus-Zeile → Aktions-Zeile (Verbinden/Trennen-Button, Demo-Chip, „Details" als dezenter Text-Link). Rechts nur noch die drei Kacheln Karts/Datenrate/GPS. Der Hero wächst mit seinem Inhalt (kein Clipping, kein Überlauf).
2. **Kart-Karten B — kompakte Zeilen-Karte:** Kopfzeile Farb-Dot + Name (flex:1) + Ampel-Badge (mono, uppercase: `● ONLINE` / `● SCHWACH` / `● OFFLINE`); darunter alle fünf Werte in **einer gleichmäßigen 5-Spalten-Rasterzeile** (Label über Wert: Signal, Rate, Verl., GPS, Alter); Hinweise als Balken (border-left in Warnfarbe, getönter Hintergrund); „Diagnose ▸/▾" als Fußzeile über die volle Kartenbreite mit Trennlinie darüber. Warn/Off-Karten: 3-px-Rand links in `--orange`/`--red` + getönte Rahmenfarbe, **ohne** Glow-Schatten.
3. **Ruhezustand A — großes Empty-State-Panel:** Sind **null** Karts sichtbar, ersetzt ein gestricheltes Panel über die volle Grid-Breite das Grid: Antennen-Icon, „Warte auf Karts…", zwei Zeilen Anleitung (Bridge anschließen + Verbinden, oder Demo) und ein „▶ Demo starten"-Chip (eigene ID, startet dieselbe Demo). Ab ≥ 1 sichtbarem Kart gilt weiter die kleine Platzhalter-Karte aus Phase 56 als letzte Zelle.
4. **Verbinden inaktiv = sichtbar grau:** Während die Demo läuft, bekommt der Button eine Disabled-Optik (gedeckter Hintergrund, gedämpfte Schrift, kein Glow); Tooltip „Demo läuft" bleibt.
5. **Aufnahme & Replay wird sekundär:** Alle drei Buttons der Karte werden Ghost-Buttons (der leuchtende Primär-Button „Aufnahme laden & abspielen" entfällt); Funktionalität unverändert.

## Nicht-Ziele

- Keine Änderung an `conn-health.js` (Logik, Schwellen, Texte) und keine neuen Unit-Tests nötig.
- Details-Aufklapper-Inhalt, Sidebar, Top-Pill, andere Tabs: unverändert.
- Demo-Chip-Verhalten und alle stabilen IDs aus Phase 56 bleiben (`#demoChip`, `#connActionBtn`, `#connDetailsBtn`, `#heroGps`, `#connGrid`, …); der Empty-State-Demo-Chip bekommt eine **eigene** ID `#emptyDemoBtn`, damit e2e-Selektoren auf `#demoChip` eindeutig bleiben.

## Technik (betroffene Dateien)

| Datei | Änderung |
|---|---|
| `index.html` | Hero: Aktions-Zeile (`#connActionBtn`, `#demoChip`, `#connDetailsBtn` als Text-Link) zieht in die linke Hero-Spalte unter `#connPortLine`; rechts bleiben die drei Kacheln. „Aufnahme & Replay": Primär-Button → `btn ghost`. |
| `src/styles/pages/connection.css` | Hero-Varianten-Fix (Höhe wächst mit Inhalt auf dem Verbindungs-Tab), Aktions-Zeile links, Details-Text-Link, Disabled-Optik `#connActionBtn[disabled]`, Kart-Karte: 5-Spalten-`.cc-vals`-Grid, Hinweis-Balken, Fußzeilen-Diagnose-Button, Warn/Off-Ränder ohne Glow, Empty-State-Panel `.conn-empty`. |
| `src/conn-ui.js` | Kartengerüst an Variante B anpassen (Badge-Texte uppercase, Fußzeilen-Button, 5er-Grid); Grid-Render: bei 0 sichtbaren Karts `.conn-empty`-Panel statt Karten/Platzhalter ausgeben. |
| `src/app-init.js` | `#emptyDemoBtn` per Event-Delegation auf `#connGrid` verdrahten (Panel wird 1-Hz-gerendert — direkte Bindung würde beim Rebuild verloren gehen). |
| `e2e/screens.spec.js` | Keine Struktur-Änderung nötig (`#heroGps`-Wait und `#connGrid .conn-card[data-mac]` bleiben gültig); Baselines `tab-connection`/`demo-connection` sind ohnehin noch nicht eingefroren. |

## Abnahme

- Kein Clipping/Überlauf bei 1440×900 und schmaler (Hero bricht sauber um).
- Demo an: Verbinden-Button sichtbar inaktiv; Karten im 5-Spalten-Raster; Warnkarte mit orangenem Rand + Hinweisbalken (Beispiel per kurzem RSSI-Abfall in der Demo nicht erzwingbar — Sichtprüfung über Hardware-Checkliste Phase 56).
- Ruhezustand: Empty-State-Panel mit funktionierendem „▶ Demo starten"; „Aufnahme & Replay" ohne Leucht-Button.
- Gates: `npm test` 222, Lint 0, CSS-Token-Gate OK, 13 e2e-Funktions-Tests grün.
