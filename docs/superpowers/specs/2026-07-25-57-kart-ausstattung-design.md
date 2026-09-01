# Phase 57 — Kart-Ausstattung (Display/RPM) + Einstellungsfenster-Layout — Design

**Datum:** 2026-07-25 · **Status:** freigegeben (Brainstorming 2026-07-25)

## Problem

1. Nicht jedes Kart hat ein OLED-Display oder einen RPM-Sensor. Die App zeigt
   trotzdem überall RPM-Werte (dauerhaft 0) und ESP-Felder, die es auf dem Kart
   gar nicht gibt. Beim ersten Verbinden eines unbekannten Karts soll ein Dialog
   die Ausstattung abfragen; später ist sie im Kart-Einstellungsfenster änderbar.
2. Das Kart-Einstellungsfenster (Phase 48, eigenes OS-Fenster, minWidth 380)
   bricht bei schmaler Fensterbreite: `.settings-row` ist eine Flex-Zeile mit
   festem 130-px-Eingabefeld — Label und Feld quetschen sich ineinander.

## Beschlossene Lösung (Locked Decisions)

- **Merkmale:** genau zwei Flags — `rpm` (RPM-Sensor vorhanden) und `display`
  (OLED vorhanden). Keine Akku-/GPS-Flags (YAGNI; `batt.present` bleibt
  Auto-Erkennung).
- **Speicherort:** im Kart-Roster-Meta pro MAC (`_persistedKarts.meta`), also
  `{name, color, lastSeenAt, equip: {rpm, display}, equipSet}`. Persistenz läuft
  über das bestehende `kartsMeta`-Feld im 9.6-Payload — kein Formatbruch,
  `SAVE_KEY` bleibt. Alt-Metas ohne `equip` gelten als voll ausgestattet,
  `equipSet` false ⇒ Dialog kommt beim nächsten Serial-Kontakt einmalig.
- **Dialog:** Modal im Hauptfenster (JS-erzeugtes Overlay, kein index.html-
  Eingriff), zwei Toggles (beide vorausgewählt), Button „Übernehmen".
  Warteschlange, wenn mehrere neue Karts gleichzeitig auftauchen.
- **Trigger:** in telemetry.js an der `lastSeenAt`-Stelle — nur Quelle
  `serial`, nie Demo (`DE:MO:*`), nie `default`-Platzhalter, nie Replay,
  nur solange `equipSet` false.
- **Später ändern:** neue Sektion „Ausstattung" im Kart-Einstellungsfenster
  (zwischen Identität und Kalibrierung), gleiche Toggles, wirkt sofort.
- **Wirkung `rpm:false`:** ausgeblendet werden RPM-KPI (Live-Einzel `#kRpm`-
  Karte + Kompakt `#kRpmLive`-Zelle), Max-RPM, RPM-Serie im Speed/RPM-Chart,
  `.ko-rpm` in der Multikart-Übersicht, `rpm-warn`-Body-Klasse; im ESP32-Panel
  die 7 sensorabhängigen Felder (espMaxRpm, espWarnRpm, espPulses,
  espWheelCirc, espGearRatio, espRpmCeiling, espRpmAlpha — Radumfang/
  Übersetzung rechnen aus denselben Sensor-Pulsen). Historische Ansichten
  (Runden-Tabellen, Rennen) bleiben unangetastet.
- **Wirkung `display:false`:** nur das Feld „OLED Seitenwechsel" (espPageMs)
  ausblenden; `page_ms` wird weiter gesendet (Sender ohne OLED ignoriert es).
- **Demo-Karts:** überspringen den Dialog, gelten als voll ausgestattet —
  E2E-Screenshots bleiben deterministisch.
- **Layout-Fix:** Media-Query `max-width: 440px` in pitwall.css — settings-rows
  stapeln (Label oben, Feld volle Breite), Button-`.row`s dürfen umbrechen.
  Greift nur im schmalen Kind-Fenster; Hauptfenster hat minWidth 900.

## Architektur

- **`src/kart-roster.js`** (pure, node:test): `equipDefaults()`,
  `equipFor(meta)` (normalisiert in-place-frei), `needsEquipDialog(meta, mac)`.
  `metaDefaults()` liefert die neuen Felder mit.
- **`src/kart-equip.js`** (neu): Erst-Verbindungs-Modal (Overlay-Erzeugung,
  Warteschlange, `maybeShowEquipDialog(mac)`), Ausstattungs-Sektion fürs
  Kart-Einstellungsfenster (Markup + Bind + Refresh), `applyEquipToEspPanel
  (doc, equip)` zum Zeilen-Ein-/Ausblenden. Importiert nur store/kart-roster/
  rasicross-Fassade — kein Zyklus.
- **Wiring:** telemetry.js (ein Aufruf), kart-settings-window.js (Sektion
  einhängen + im Refresh anwenden), live-ui.js (KPI/Chart/warn), 
  kart-overview.js (`.ko-rpm` weglassen).

## Tests & Verifikation

- node:test für die drei Roster-Helfer (Defaults, Alt-Meta-Normalisierung,
  Demo/default-Ausschluss).
- Baselines bleiben grün: npm test 222, Python 65, Lint 0/OK, 13 E2E lokal
  (vor Abschluss frisch messen — Zahlen wachsen mit dieser Phase).
- Manuell/Hardware (deferred an den User): echtes unbekanntes Kart verbinden ⇒
  Dialog; Ausstattung im Fenster umschalten ⇒ Live-UI folgt; Fenster schmal
  ziehen ⇒ keine Überlappung.

## Nicht in dieser Phase

- Auto-Erkennung der Ausstattung aus Telemetrie.
- RPM-Ausblendung in historischen Runden-/Renn-Tabellen.
- Ausstattungs-Badges auf der Karts-Seite.
