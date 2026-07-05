# Per-Kart-OLED-Display-Routing — Design (Phase 40)

**Datum:** 2026-07-03
**Status:** Freigegeben (User-Approval im Design-Dialog, Ansatz A inkl. Per-Kart-Delta)
**Umfang:** Rein Dashboard-seitig — bridge.py und sender.py bleiben unverändert.

## Kontext

Seit Phase 39 ist die Multikart-Funktion dashboard-seitig vollständig, aber die
OLED-Display-Updates (`type: "display"`) gehen nur an den **aktiven** Kart:
`sendDisplayUpdate()` (pit-wall.js) baut ein Payload aus der Aktiv-Kart-Fassade,
dedupliziert über einen globalen `structuralRaceKey` + 5-s-Keepalive und routet
via `rasiBridgeSend` (setzt `target_mac` = aktiver Kart). Fahrer anderer Karts
sehen auf ihrem Display fremde oder veraltete Daten.

Die Infrastruktur darunter kann bereits alles Nötige:
- Bridge `_forward_to_kart()` routet jedes Downlink-Paket an eine beliebige
  `target_mac` (Fallback: zuletzt gehörter Kart) und prüft das 250-B-Budget.
- Sender-ESP konsumiert `display`-Pakete (`display.set_race_data`), ignoriert
  `target_mac` als reines Routing-Feld.

## Design-Entscheidungen (locked)

### D1 — `buildRaceDataForKart(mac)` parametrisieren
Die Funktion liest statt der Fassade den Kart-Bucket und Teilnehmer-Slot:
- `k = state.karts.get(mac)` (null-sicher), `part = RasiLapEngine.partOf(r, mac)`.
- Rundenzeit/Anker: `k.lapStart`; Sektor-States: `k.sectorsLive`; Best:
  `part.bestLapMs`/`part.bestLapNum` (Fallback `k.bestLapMs`/`k.bestLapNum`);
  Live-Delta: `k.liveDelta` (siehe D4); Rundenzähler: `partValidLaps(part)`.
- **Fahrer aus `part.currentDriverId`** (per-Kart seit Phase 35), nicht mehr
  `r.currentDriverId`.
- `pit`-Flag nur für den Kart, an den der letzte Pit-Call ging (D3).
- Kein laufendes Rennen oder Kart kein Teilnehmer: Page-Only-Paket wie bisher
  (`{type:'display', page, sectors:['open','open','open']}`) — die OLED-Page-
  Wahl ist global und geht an alle Karts.
- Race-globale Felder bleiben: `target`, `elapsed_ms`, `remaining_ms`,
  `length_type`, `page`.

### D2 — `sendDisplayUpdate()` als Schleife mit per-MAC-Dedupe
- Schleife über `state.karts.macs()`; ist die Registry leer, ein Paket ohne
  `target_mac` (Single-Kart-/Bridge-Fallback-Verhalten wie heute).
- Dedupe pro MAC: `_lastDisplayKeyByMac[mac]` + `_lastDisplayAtByMac[mac]`
  (Key = `structuralRaceKey`, Keepalive `RC_DISPLAY_KEEPALIVE_MS` = 5 s je Kart).
- `target_mac` wird explizit ins Payload gesetzt (der `rasiBridgeSend`-Default
  würde sonst immer den aktiven Kart adressieren). Für den
  `KartRegistry.DEFAULT_MAC`-Bucket KEIN `target_mac` (Bridge-Fallback).
- Demo-Karts (`DE:MO:*`) werden übersprungen — es gibt keine echten Empfänger,
  und `sendDisplayUpdate` läuft ohnehin nur bei `source === 'serial'`; der
  Skip schützt den Mischfall (Serial verbunden, Demo-Reste in der Registry).
- Traffic-Budget: Payload-Größe pro Paket unverändert (<250 B); strukturelle
  Änderungen sind pro Kart selten (Rundenende, Sektor, Fahrerwechsel);
  Keepalive 4 Karts × 0,2 Hz ist vernachlässigbar für USB und ESP-NOW.

### D3 — Pit-Call-Ziel merken
`togglePitCall`/`sendPitCall` merken sich beim Aktivieren die Ziel-MAC
(`_pitCallMac = state.activeKartMac`). `buildRaceDataForKart(mac)` setzt
`pit: true` nur für diese MAC solange `_pitCallActive`. Abbruch/Timeout setzt
`_pitCallMac = null`. (Der eigentliche OLED-Override läuft weiterhin über das
separate `pit_call`-Paket — das `pit`-Feld ist der redundante Anzeige-Flag.)

### D4 — Per-Kart-Live-Delta
`updateLiveDelta()` (live-ui.js) berechnet das Delta heute nur für den aktiven
Kart (Fassade) — Hintergrund-Karts hätten auf ihrer Delta-Page dauerhaft "--".
- Kernrechnung als pure Funktion nach **geo.js** extrahieren:
  `nearestTraceDelta(bestTrace, cur)` → `deltaMs | null`
  (nächster Punkt der Best-Trace zur aktuellen Position via quadratischem
  lat/lon-Abstand; `cur = {t, lat, lon}`; null bei <5 Trace-Punkten oder
  fehlender Position). UMD-Export + node:test.
- `updateLiveDelta()` läuft weiter im 500-ms-Throttle, iteriert aber alle
  `state.karts.macs()`: `k.liveDelta = nearestTraceDelta(k.bestLapTrace,
  letzter Punkt von k.currentLapTrace)`. Ohne laufende Runde/Trace: null.
- DOM (Delta-Banner) wird unverändert NUR aus dem aktiven Kart gespeist.

## Fehlerbehandlung
- `buildRaceDataForKart(mac)`: fehlender Bucket/Teilnehmer → Page-Only-Paket
  (nie Exception); Schleife in try/catch je Kart, ein Sendefehler stoppt die
  anderen Karts nicht (bestehendes Stumm-Muster bleibt).
- Bridge meldet weiterhin `payload_too_long`/`no_target` als `bridge_error` —
  keine neuen Fehlerpfade nötig.
- `nearestTraceDelta` ist total (null statt Wurf bei kaputten Eingaben).

## Tests
- **node:test (neu, geo.js):** `nearestTraceDelta` — normaler Treffer,
  <5 Punkte → null, fehlende cur-Position → null, exakter Punkt → Delta 0,
  Verhalten identisch zur bisherigen Inline-Rechnung (gleiche Formel).
- **Bestehende Baselines grün:** `structuralRaceKey`-Tests unverändert,
  `node --test`, `node --check`, `npm run lint`; kein Python-Touch.
- **Hardware-Abnahme (User, 2+ Karts):** jeder Kart zeigt eigenen Fahrer,
  eigene Runden-/Bestzeit und eigenes Delta; Pit-Call-Flag nur beim
  adressierten Kart; Single-Kart-Betrieb verhält sich wie vorher.

## Nicht-Ziele
- Keine Änderungen an bridge.py/sender.py (Routing + Display-Konsum existieren).
- Kein Display-Downlink im Demo-Modus (wie bisher: nur bei USB-Serial).
- Keine neuen Payload-Felder / kein Format-Versionssprung (250-B-Budget,
  `_ACK_KEYS`-Kompaktkeys bleiben unberührt).
