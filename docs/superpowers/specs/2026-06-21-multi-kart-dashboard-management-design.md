# Multi-Kart Dashboard-Verwaltung — Design (Phase 28b)

**Status:** Entwurf (genehmigt)
**Datum:** 2026-06-21
**Realisiert:** Dashboard-Bedienoberfläche für die in Phase 28 bereits vorhandene Multi-Kart-Pipeline.
**Vorgänger-Spec:** `docs/superpowers/specs/2026-06-21-multi-kart-support-design.md`
**Branch:** `feat/multi-kart-support` (Folge-Arbeit auf demselben Branch / PR #46)

---

## 1. Problem / Motivation

Phase 28 hat die volle Per-Kart-Pipeline geliefert (Registry, Proxy-Fassade, Kart-Leiste, Per-Kart-Telemetrie/Recording/Rennen, Bridge-Multi-Host inkl. `forget_kart_mac`/`reset_karts`/`target_mac`). Auf der **Bedien**-Seite fehlen aber drei Dinge, damit Multi-Kart praktisch nutzbar ist:

1. **Kart benennen / Farbe** — die Chips zeigen nur Auto-Namen („Kart 1/2"); es gibt keine Möglichkeit, Name oder Farbe zu setzen.
2. **Kart-Verwaltung (Vergessen/Reset)** — die Bridge unterstützt `forget_kart_mac`/`reset_karts`, aber das Dashboard sendet diese Kommandos nirgends und kann einen Kart nicht aus der lokalen Registry entfernen.
3. **Connection-Tab Multi-Kart** — der Verbindungs-Tab zeigt nur den aktiven Kart (folgt der Proxy-Auswahl); eine Aufschlüsselung aller Karts fehlt.

Diese Phase (28b) ergänzt ausschließlich die Dashboard-UI. **Keine** Bridge-/Firmware-Änderung (die Kommandos existieren bereits), **kein** neues Persistenz-Format.

## 2. Locked Decisions

1. **Umbenennen/Farbe/Vergessen** leben in einem **Popover pro Chip** (Klick auf ein `✏` am Chip). Chip-Körper-Klick wählt weiterhin nur aus.
2. **Farbwahl** = feste 5er-Palette (`kart-bar.js` `PALETTE`), **kein** freier Farbwähler (YAGNI).
3. **Connection-Tab** bekommt oben eine **Per-Kart-Statusliste** (Klick = auswählen) plus darunter das **bestehende Detail-Diagramm** (folgt aktivem Kart), mit Überschrift „Detail: <Name>".
4. **Alle Karts zurücksetzen** ist ein Button **unter der Karts-Liste im Connection-Tab** (mit `rcConfirm`-Bestätigung).
5. **Vergessen** entfernt den Kart lokal aus der Registry **und** sendet (falls Bridge verbunden) `{type:'forget_kart_mac', mac}` direkt an die Bridge — Bridge-Kommando, **nicht** kart-geroutet (kein `target_mac`/`bridgeSend`).
6. **`kartMeta`** (Name/Farbe je MAC, `localStorage` `rasi.kartMeta.v1`) bleibt nach Vergessen/Reset **erhalten** (Re-Pairing stellt Name/Farbe wieder her). Es ist das einzige (bereits vorhandene) neue localStorage-Feld.
7. **Single-Kart-Regression:** Bei ≤1 Kart ohne echte MAC (nur `default`-Bucket) bleiben Chip-Leiste **und** Karts-Liste versteckt; das Dashboard verhält sich exakt wie heute.

## 3. Architektur & Komponenten

### 3.1 Chip-Popover — `kart-bar.js` (+ HTML/CSS)

- **Chip-Layout:** jeder Chip erhält rechts ein `✏`-Edit-Icon. Reihenfolge: `[●Name  Hz RSSI Batt REC ✏]`. `✏`-Klick ruft `stopPropagation()` und öffnet das Popover; der restliche Chip wählt aus (wie bisher).
- **Popover (ein wiederverwendetes DOM-Element):**
  - Name: `<input type="text" maxlength="20">`, vorbelegt mit `kartMeta[mac].name`.
  - Farbe: 5 Swatch-Buttons aus `PALETTE`, aktive Farbe markiert.
  - **Vergessen**-Button (danger).
  - Speichern erfolgt **live** (oninput/onclick): `state.kartMeta[mac] = {name, color}` → `saveMeta` → `render(state)` (Chips) + `renderConnectionTab()` (Liste).
- **Positionierung:** absolut unter dem auslösenden Chip (Bounding-Rect). Schließt bei Klick außerhalb oder `Esc` (ein globaler Listener, der beim Öffnen registriert und beim Schließen entfernt wird).
- **Vergessen-Aktion** (`forgetKart(mac)`):
  1. `state.karts.forget(mac)`; `delete state._kartHz[mac]`.
  2. Falls `state.serial?.connected`: `window.rasiSerial.writeLine(JSON.stringify({type:'forget_kart_mac', mac}))`.
  3. `state.activeKartMac = state.karts.activeMac()` (Registry hat aktiv bereits umgepointet).
  4. Popover schließen, Chips + Connection-Liste neu rendern, `rcToast`.
  - `kartMeta[mac]` bleibt erhalten.

### 3.2 Connection-Tab Karts-Liste — `pit-wall.js` (+ HTML/CSS)

- **Neuer Container** `#connKartList` oben im Connection-Tab (vor dem bestehenden Detail-Diagramm), plus Button `#resetKartsBtn` darunter.
- **`renderConnKartList()`** (aufgerufen aus `renderConnectionTab()`, läuft im 1-Hz-Loop):
  - Eine Zeile je `state.karts.macs()`: Farb-Punkt (`kartMeta` Farbe), Name, `Hz` (`state._kartHz[mac]`), `RSSI`, `Lost` (`k.connection.lost`), Alter (`Date.now()-k.connection.lastPacketAt`), Akku-% (falls `k.batt.present`), REC-Punkt (`k.recording.armed`). Stale-Markierung bei Alter > 2 s.
  - Klick auf Zeile: `state.karts.setActive(mac)` + `state.activeKartMac = mac` → Re-render. Aktive Zeile hervorgehoben.
  - Sichtbarkeit: Container `display:none` bei `macs().length <= 1` (wie Chip-Leiste).
- **Detail-Überschrift** `#connDetailTitle`: „Detail: <aktiver Kart-Name>". Das bestehende Diagramm bleibt unverändert (liest weiter `state.connection`/`state.telemetry` via Proxy = aktiver Kart).
- **`resetKarts()`** (`#resetKartsBtn` onclick):
  1. `rcConfirm('Alle Karts vergessen? …', …)`; bei Abbruch return.
  2. `state.karts.reset()`; `state._kartHz = {}`; `state.activeKartMac = null`.
  3. Falls verbunden: `window.rasiSerial.writeLine(JSON.stringify({type:'reset_karts'}))`.
  4. Re-render, `rcToast`. `kartMeta` bleibt erhalten.

### 3.3 Geteilte Bausteine / Bestehendes

- `kartMeta`, `PALETTE`, `loadMeta/saveMeta/metaFor` existieren bereits in `kart-bar.js`. Die Connection-Liste greift über `state.kartMeta` auf dieselben Daten zu; `kart-bar.js` exportiert ggf. einen kleinen Helfer (`window.RasiKartBar.forget` / `meta`) für `pit-wall.js`.
- Bridge-Kommandos `forget_kart_mac`/`reset_karts` sind in `bridge.py` bereits implementiert (Phase 28) — hier nur Auslöser.
- `request_status`/`bridge_status.karts[]` füttern `state._kartHz` und die Per-Kart-`connection`-Felder bereits (Phase 28).

## 4. Datenfluss

```
Chip ✏  ──▶ Popover ──▶ kartMeta[mac]={name,color} ──▶ localStorage
                         └▶ render Chips + Connection-Liste
Chip body / Listenzeile ──▶ karts.setActive(mac)+activeKartMac ──▶ Re-render (Rich-View folgt)
Popover „Vergessen" ──▶ karts.forget(mac) (+ writeLine forget_kart_mac) ──▶ Re-render
Reset-Button ──▶ rcConfirm ──▶ karts.reset() (+ writeLine reset_karts) ──▶ Re-render
```

## 5. Fehler-/Randfälle

- **Offline (keine Bridge):** Vergessen/Reset wirken trotzdem lokal (Registry/UI); Bridge-`writeLine` wird übersprungen.
- **Aktiven Kart vergessen:** Registry pointet `activeMac` auf den ersten verbleibenden; `activeKartMac` wird nachgezogen. Bei letztem Kart → `null` (Fallback `activeKart()` legt bei Bedarf `default` an).
- **Name leer:** fällt auf Auto-Namen (`metaFor`) zurück.
- **Popover offen + Liste re-rendert (1 Hz):** Popover ist ein eigenständiges Overlay (nicht Teil der Chip-`innerHTML`), bleibt also bestehen; Liste/Chips dürfen es nicht zerstören.
- **Stale-Kart:** Liste & Chip grauen bei Alter > 2 s aus; Auswahl/Vergessen bleiben möglich.

## 6. Tests / Verifikation

- Logik ist überwiegend DOM-gebunden → kein neues `node:test`-Modul. Verifikation:
  - `node --check kart-bar.js pit-wall.js rasicross.js` (und weitere berührte) — syntaxsauber.
  - Bestehende Baselines grün halten: `node --test` (126), `python -m py_compile bridge.py`, `python -m unittest` (50 OK). **Keine** Python-/Bridge-Logik wird berührt.
- **Manuell (Hardware, an Nutzer):** zwei Karts → Popover umbenennen/Farbe wirkt auf Chip + Liste; Vergessen entfernt einen Kart lokal und auf der Bridge (OLED-Zähler sinkt); Reset leert alles; Connection-Liste zeigt Per-Kart Hz/RSSI/Lost/Akku; Auswahl per Zeile schaltet die Rich-View um; Single-Kart unverändert.

## 7. Betroffene Dateien

| Aktion | Datei | Zweck |
|--------|-------|-------|
| Ändern | `kart-bar.js` | `✏`-Icon, Popover (Name/Farbe/Vergessen), `forgetKart`, Helfer-Export. |
| Ändern | `pit-wall.js` | `renderConnKartList()`, Detail-Titel, `resetKarts()`; Aufruf aus `renderConnectionTab()`. |
| Ändern | `RasiCross_Telemetry.html` | Popover-Markup, `#connKartList`/`#resetKartsBtn`/`#connDetailTitle`, CSS (Popover, Listenzeilen, Swatches). |
| Unverändert | `bridge.py`, Registry-Logik | Kommandos existieren bereits. |

## 8. Phase Map

- **Phase 28:** volle Per-Kart-Pipeline (geliefert, PR #46).
- **Phase 28b (dieser Spec):** Dashboard-Bedienoberfläche für Verwaltung/Benennung/Connection-Übersicht.
- **Deferred (29-Kandidat):** Cross-Kart-Leaderboard / Best-Lap-Vergleich; optionaler freier Farbwähler; Chip-Sortierung.
