# Phase 38 — UX/Design-Polish — Design

## 1. Kontext

Nach einem vollständigen UX/Design-Review der Oberfläche (Code-Review +
visueller Durchgang via Electron-Screenshots in dark/light/outdoor und
Desktop/Mobil). Gesamturteil: starkes, bewusst gestaltetes System mit eigener
Identität; Schwächen fast ausschließlich in **Tastatur-/Barrierefreiheit** und
**handlungsleitender Copy**, nicht in der Optik. Mobil und Themes sind bereits
gut gelöst.

## 2. Befunde & Entscheidungen

**Umgesetzt:**

1. **Tastatur-Fokus unsichtbar** (Hoch, A11y). `:focus-visible` kam 0× vor;
   `.btn`/`.nav-item` hatten keinen Fokus-Stil → WCAG 2.4.7-Verstoß. Globaler
   `:focus-visible`-Outline (Lime; Outdoor: 3 px schwarz). Inputs/Selects
   behalten ihren bestehenden box-shadow-Ring.
2. **Nav-Semantik** (Mittel). Tabs lagen in `<div>`s ohne Landmark; aktiver Tab
   nur farblich. → `<nav aria-label="Hauptnavigation">` + `aria-current="page"`
   am aktiven Tab (in Markup initial + JS beim Tab-Wechsel gepflegt).
3. **Icon-Buttons ohne Namen** (Mittel). Mobile-Menü öffnen/schließen ohne
   `aria-label` → ergänzt ("Menü öffnen"/"Menü schließen").
4. **Touch-Ziele 38 px** (Mittel). Icon-Buttons unter 44 px → auf
   `@media (pointer:coarse)` 44 px (Handy/Handschuhe an der Boxengasse).
5. **Map-Toggle „M"** (Politur). Kryptischer Buchstabe → Layers-Icon.
6. **Leerzustände passiv** (Politur). „Noch keine Rennen/Fahrer/Strecke" nennen
   nur die Leere → jetzt handlungsleitend (Wohin/Wie), in JS-Render UND
   HTML-Platzhalter.

**Verworfen — kein echter Bug:**

- **„Outdoor-Karte bleibt dunkel"** (im visuellen Review als Hoch notiert). Die
  Kartendunkelheit kommt von der **vom Nutzer gewählten Tile-URL**
  (`state.settings.tiles.urlTemplate`), nicht vom Theme: `paintTilesOn` malt
  Tiles nur, wenn der Nutzer den Karten-Hintergrund aktiviert hat; ohne Tiles
  ist der Basis-Fill bereits `css('--soft')` → in Outdoor hell. Ein „Fix" würde
  die explizite Karten-Wahl des Nutzers im Outdoor-Theme überschreiben. Daher
  bewusst nicht angefasst. (Optionale spätere Idee: ein „Auto"-Tile-Stil, der
  hell/dunkel dem Theme folgt — eigenes Feature, nicht Polish.)

## 3. Verifikation

`node --check` + `eslint` (rasicross/races/laps-drivers), `node --test` (173,
unverändert — JS-Logik nicht berührt), plus **visueller Re-Check** via Electron:
Fokus-Ring sichtbar, Map-Icon vorhanden, `aria-current` folgt dem Tab,
`nav[aria-label]` vorhanden. Reines CSS/Markup/Copy → keine neuen Unit-Tests.

## 4. Nicht berührt

Telemetrie/Engine/Geo-Logik, Phase 36/37, Farbsystem/Identität, Layout-Raster.
