# RasiCross — Drift- & Abhebe-Erkennung (Drift Detection + Roll-Angle / Wheel-Lift)

**Date:** 2026-05-30
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

Der Nutzer möchte aus der vorhandenen Telemetrie ableiten, **(a)** ob der
Mäher *driftet* (Über-/Untersteuern, Schwimmen) und **(b)** ob er seitlich so
weit kippt, dass *zwei kurveninnere Räder vom Boden abheben*.

Die Analyse der heutigen Datenlage (`frame.py`, `sender.py`, `mpu6050.py`)
ergab eine klare Trennlinie, die den Phasenschnitt bestimmt:

- **Drift ist mit den heute schon gesendeten Feldern erkennbar.** Seit Phase 5
  (A4 IMU-Expansion) liegen `yaw` (Gierrate Gyro-Z, °/s), `gy` (Querbeschleu­
  nigung, g) und `speed` (km/h) im Frame und auf dem Dashboard vor. Drift ist
  damit **reine Dashboard-Analytik — keine Firmware-Änderung nötig.**
- **Abheben braucht eine echte Roll-Information.** Die kurzfristig zuverlässige
  Größe — die **Roll-Rate (Gyro-X)** — wird vom MPU-6050 zwar gelesen
  (`sender.py:326` liest `_gxr, _gyr, gzr = self._mpu.gyro`), aber **verworfen**;
  nur Gyro-Z (`yaw`) geht ins Paket. Abheben erfordert daher einen
  Firmware-Eingriff (Roll-Rate senden) plus eine Rollwinkel-Fusion.

Der Spec liefert deshalb **zwei unabhängig lieferbare Phasen**:

| | **Phase 18 — Drift** | **Phase 19 — Rollwinkel / Abheben** |
|---|---|---|
| Firmware? | **Nein** | **Ja** — Frame v2, beide ESPs neu flashen |
| Kern | Gierraten-Index (gemessene vs. erwartete Gierrate) | Komplementärfilter-Rollwinkel + Schwelle |
| Sofort nutzbar | ✅ (auch auf bestehenden Aufnahmen) | erst nach Reflash |
| Sichtbar | Live **und** Replay | Live **und** Replay |

Phase 18 wird zuerst geplant und umgesetzt. Phase 19 baut additiv darauf auf
und kann später erfolgen.

## 2. Background / grounding facts

- **Telemetrie-Frame** (`frame.py`): festes 33-Byte Little-Endian Layout,
  `FMT = "<BHHHhhhhiiHHHBbBB"`, `FRAME_VER = 1`. Felder u.a.: `speed` (×100),
  `rpm`, `gx`/`gy`/`gz` (Accel, g ×1000), `yaw` (Gyro-Z °/s ×10), `lat`/`lon`,
  `pulse_hz`, Batterie, Flags. **`pack` sättigt und wirft nie**; `unpack` prüft
  `buf[0] == FRAME_VER` und exakte Länge, liefert sonst `{'_err': 'bad_ver'|'bad_len'}`.
- **IMU** (`mpu6050.py`, `sender.py`): MPU-6050, `ACCEL_CONFIG = 0x00` → **±2 g**
  (Skalierung 16384), `GYRO_CONFIG = 0x00` → ±250 °/s (Skalierung 131). Die
  `gyro`-Property liefert bereits **alle drei** Achsen `(gx, gy, gz)` in °/s;
  `IMU.update()` nutzt davon heute nur `gzr` (= `yaw`). `gx`/`gy` im Paket sind
  **Accel**-Achsen (geglättet, im Stand auf 0 kalibriert), nicht Gyro — der
  Name ist historisch. `gz` = Accel-Z (≈ 1 g im Stand). Glättung: gemeinsamer
  EMA `alpha = Config.G_ALPHA` (0.30).
- **Bridge** (`bridge.py:512`): erkennt Binär-Frames über
  `msg[0] == frame.FRAME_VER and len(msg) == frame.SIZE` und ruft
  `frame.unpack`. Ein Versions-/Längen-Bump in `frame.py` wird also **automatisch
  übernommen**, sobald beide ESPs dieselbe `frame.py` haben — das bestehende,
  dokumentierte „auf BEIDE ESPs flashen"-Modell.
- **Dashboard** (`rasicross.js`): `processTelemetry(d)` (Zeile ~430) parst u.a.
  `gx`/`gy` (minus Kalibrier-Null), `gz`, `yaw` (→ `state.imu.yaw`), schreibt
  `state.raw = { speed, rpm, gx, gy, gz, yaw, lat, lon, pulseHz }` und füllt
  Chart-Ringpuffer `state.charts.{speed,rpm,gx,gy,gz,yaw}` (max 600). KPIs in
  `updateLiveKPIs` (G-Kraft-Sub-Zeile hat `kYaw`/`kMtemp`). Demo-/Replay-Pfade
  rufen denselben `processTelemetry`.
- **Reine, getestete Module:** abhängigkeitsfreie UMD-Module mit `node:test`
  (`geo.js`, `replay.js`, `tiles.js`, `dom-targets.js`), per `<script>` vor
  `rasicross.js` geladen (`RasiCross_Telemetry.html:3357-3365`). Ladeordnung
  heute: `geo → replay → tiles → tile-renderer → dom-targets → rasicross`.
- **ESP-Logik in CPython getestet:** `esp_libs/calc.py` und `frame.py` sind
  importfrei und laufen unter CPython (CI) wie MicroPython; `test/test_calc.py`,
  `test/test_frame.py` decken sie ab.
- **Packaging:** `package.json` `build.files` zählt die gebündelten `.js`-Dateien
  auf — jede neue Top-Level-`.js` **muss** dort eingetragen werden, sonst fehlt
  sie im Release. `eslint.config.js` deklariert Browser-Globals pro Modul
  (`DomTargets`/`RasiTiles`-Präzedenz).
- **Test-Baselines (2026-05-30):** `npm test` / `node --test` = **52** JS-Tests;
  `python -m unittest discover -s test` = **34** Tests (calc + frame).
  `package.json.version` = 9.6.0. Höchste bestehende Phase = 17.
- **Aufnahme/Replay (`replay.js`, C1 / Phase 6):** der Recorder erfasst das
  Telemetrie-Paket; `yaw`/`gy`/`speed` sind in Aufnahmen ab Phase 5 vorhanden.
  Der Implementierungsplan **verifiziert** vor Code, dass Recorder/Replay diese
  Felder durchreichen, und ergänzt sie additiv, falls nicht.
- **Hardware nicht testbar hier:** ESP32 + MPU-6050 liegen nicht vor. ESP-Code
  wird statisch reviewt + `py_compile` + `unittest` (für `frame.py`/`calc.py`)
  und vom Nutzer per Hardware-Checkliste verifiziert (A1/A4-Präzedenz).

## 3. Scope

### Phase 18 — Drift (Dashboard-only)

| ID | Item | Surface |
|----|------|---------|
| D1 | Reines Drift-Modul `drift.js` + Unit-Tests | neue Datei + `test/` |
| D2 | Live-Berechnung in `processTelemetry` + `state.drift` | `rasicross.js` |
| D3 | Live-Anzeige: Drift-Status-Badge + Index in der G-Kraft-KPI-Zeile | `rasicross.js`, HTML, CSS |
| D4 | Replay-Auswertung: Drift-Phasen markiert + Statistik (Zeitanteil %, max Index) | `rasicross.js`, `replay.js` (nur falls Feld-Durchreichung fehlt) |
| D5 | Settings: Drift-Empfindlichkeit (Toleranz) + Min-Speed-Gate | `rasicross.js`, HTML |
| D6 | `build.files` / `eslint.config.js` / Script-Tag für `drift.js` | `package.json`, `eslint.config.js`, HTML |

### Phase 19 — Rollwinkel / Abheben (Firmware + Dashboard)

| ID | Item | Surface |
|----|------|---------|
| R1 | `frame.py` v2: `roll`-Feld (Gyro-X °/s ×10), `FRAME_VER = 2` + Round-Trip-Tests | `frame.py`, `test/test_frame.py` |
| R2 | `sender.py`: Gyro-X glätten → `imu.roll_rate`, `roll` in jedem Paket | `sender.py` |
| R3 | Accel-Range ±2 g → ±4 g (`ACCEL_CONFIG`, Skalierung 8192) — **bestätigungspflichtig** | `mpu6050.py`, `sender.py` |
| R4 | Reines Attitude-Modul `attitude.js` (Komplementärfilter + Abhebe-Event) + Tests | neue Datei + `test/` |
| R5 | Dashboard: `roll` parsen, Rollwinkel-Fusion, `state.attitude` | `rasicross.js` |
| R6 | Live-Anzeige: Rollwinkel (°/Neigungs-Indikator) + „LIFT!"-Warnung | `rasicross.js`, HTML, CSS |
| R7 | Replay: Rollwinkel-Spur + markierte Abhebe-Events | `rasicross.js` |
| R8 | Settings: Rollwinkel-Schwelle (°) + Null-Kalibrierung im Stand | `rasicross.js`, HTML |
| R9 | `build.files` / `eslint.config.js` / Script-Tag für `attitude.js` | `package.json`, `eslint.config.js`, HTML |

### Out of scope

- **Schwimmwinkel β aus GPS-Kurs** (Drift-Ansatz 2/Hybrid) — bewusst verworfen
  zugunsten des robusten, GPS-unabhängigen Gierraten-Index. Kann später als
  Anzeige-Ergänzung kommen, wenn gewünscht.
- **Geometrische Kippgrenze** aus Spurbreite + Schwerpunkthöhe — verworfen
  zugunsten der empirischen, im Feld kalibrierten Rollwinkel-Schwelle (keine
  Fahrzeug-Vermessung nötig). Die Schwelle bleibt ein einstellbarer Parameter.
- **Pitch-Achse / vorne-hinten-Abheben** (Wheelie/Nicktauchen) — nur Roll
  (seitliches Kippen) in Phase 19. Gyro-Y bleibt ungesendet; eine spätere Phase
  kann es additiv ergänzen (gleiches Frame-v2-Muster).
- **Aktive Eingriffe / Warntöne am Kart-OLED** — die Erkennung ist rein
  dashboard-/auswerteseitig. Keine `sender.py`-Display- oder Buzzer-Logik.
- **Absoluter Heading / Magnetometer / GPS-Kursfusion** — der MPU-6050 hat kein
  Magnetometer; es wird keiner ergänzt.

## 4. Cross-cutting constraints

### 4.1 Backwards compatibility & Frame-Budget

- **Phase 18** ist rein additiv im Dashboard: kein Frame-, kein ESP-Eingriff.
  Funktioniert auf Live-Daten **und** auf bestehenden Aufnahmen unverändert.
- **Phase 19** bumpt `FRAME_VER` 1 → 2 und SIZE 33 → 35 B. Ein v1-Sender an
  eine v2-Bridge (oder umgekehrt) wird über die `FRAME_VER`/`SIZE`-Prüfung in
  `bridge.py:512` bzw. `unpack` **sauber abgewiesen** (`bad_ver`/Längenfilter) —
  kein Fehlinterpretieren. Konsequenz: **beide ESPs zusammen flashen** (das
  bestehende dokumentierte Modell). Frame bleibt mit 35 B weit unter dem
  250-B-ESP-NOW-Budget.
- Das Dashboard parst `roll` **optional** (`Number(d.roll) || 0`, fehlend ⇒
  Roll-Feature still inaktiv / Anzeige `--`). Alte Aufnahmen ohne `roll` spielen
  ohne Rollwinkel-Spur ab; Drift-Auswertung bleibt verfügbar.
- Keine bestehenden Paket-Keys werden umbenannt oder entfernt.

### 4.2 ±4 g-Umstellung (R3) — bestätigungspflichtig

Die Rollwinkel-Fusion nutzt Accel als Schwerkraft-Referenz. Bei harten Kurven
oder Bordstein-Schlägen sättigt der ±2-g-Bereich auf der `gy`-Achse und
verfälscht die Referenz; auch der Drift-Index (Phase 18) profitiert von mehr
Headroom. Empfehlung: `ACCEL_CONFIG` auf ±4 g (Skalierung 16384 → 8192).

**Nebenwirkung:** Halbiert die Auflösung der bestehenden `gx`/`gy`/`gz`-Werte
(±2 g im Alltag weiterhin gut aufgelöst). Da dies bestehendes Verhalten ändert,
ist R3 als **eigene, übersprungbare Task** geführt und im Hardware-Check separat
abgenommen. Wird R3 weggelassen, funktioniert Phase 19 weiterhin — mit
möglicher Sättigung bei sehr hoher Querbeschleunigung (in der Doku vermerkt).

### 4.3 Keine neuen Laufzeit-Abhängigkeiten / Vanilla-only

`drift.js` und `attitude.js` sind reine, importfreie UMD-Module (Browser:
`window.RasiDrift` / `window.RasiAttitude`; Node: `module.exports`), analog zu
`geo.js`/`replay.js`. Keine npm-Pakete. ESP-Code bleibt importfrei außer den
bestehenden MicroPython-Modulen.

### 4.4 Vorzeichen-/Orientierungskonvention

Die Verknüpfung von Gierrate, Querbeschleunigung und Roll-Rate hängt von der
Einbaulage des MPU-6050 ab. Der Spec legt keine feste Polarität fest; die
Module arbeiten mit Beträgen plus einem **Vorzeichen-Konsistenz-Check** (siehe
§5.1), und die Einbau-Orientierung (Vorzeichen-Flip pro Achse) wird über die
bestehende IMU-Kalibrier-/Settings-Struktur behandelt bzw. im Hardware-Check
verifiziert. Keine Annahme „positiv = links".

## 5. Detailed design

### 5.1 Drift-Modul (`drift.js`, Phase 18)

Neues UMD-Modul, deterministisch & seiteneffektfrei. Exportiert eine Namespace
mit reinen Funktionen:

```js
// Erwartete Gierrate (°/s) für saubere Kurvenfahrt aus Querbeschleunigung & Tempo.
//   latAccelG : Querbeschleunigung in g (Betrag genutzt)
//   speedKmh  : Geschwindigkeit in km/h
RasiDrift.expectedYawRate(latAccelG, speedKmh) → number  // °/s, 0 wenn v≈0

// Drift-Auswertung eines Samples.
//   { yawRate, latAccel, speed } + opts { tol, minSpeedKmh, minLatG }
RasiDrift.analyze({ yawRate, latAccel, speed }, opts) → {
  status,        // 'n/a' | 'grip' | 'oversteer' | 'understeer' | 'counter'
  index,         // |yawGemessen| / erwartete Gierrate, oder null bei 'n/a'
  expectedYaw    // °/s
}

// Aggregat über eine Sample-Sequenz (Replay): Zeitanteil & Extremwerte.
RasiDrift.summarize(samples, opts) → {
  total, counted,           // Anzahl Samples / davon nicht 'n/a'
  driftCount, driftPct,     // 'oversteer'|'counter'-Anteil
  understeerPct, maxIndex
}
```

**Mathematik** (`analyze`):
- `v = speedKmh / 3.6` (m/s); `a = |latAccel| * 9.80665` (m/s²)
- erwartete Gierrate `ω_exp = (a / v) · 180/π` (°/s)
- **Gate:** `v < minSpeedKmh/3.6` **oder** `|latAccel| < minLatG` ⇒
  `status='n/a'`, `index=null` (gerade/langsam → Quotient würde rauschen).
  Defaults: `minSpeedKmh = 5`, `minLatG = 0.15`.
- `index = |yawRate| / ω_exp`
- **Status** (Default `tol = 0.25`):
  - Vorzeichen-Check: weichen `sign(yawRate)` und das erwartete
    Kurven-Vorzeichen (aus `latAccel` unter der kalibrierten Orientierung)
    voneinander ab ⇒ `'counter'` (Gegenlenken/Spin).
  - sonst `index > 1+tol` ⇒ `'oversteer'` (Heck dreht über → Drift);
    `index < 1−tol` ⇒ `'understeer'` (Schieben); dazwischen ⇒ `'grip'`.
- Robust gegen `NaN`/`0`/negative Eingaben (liefert `'n/a'`, wirft nie) — gleiche
  Defensive wie `calc.py`.

### 5.2 Drift-Verdrahtung (`rasicross.js`, Phase 18)

- **State:** `state.drift = { status:'n/a', index:null }`; Ringpuffer
  `state.charts.driftIndex` (max 600), in den Reset-/Init-Pfaden mitgeführt
  (analog zu `state.charts.*` und `state.imu`).
- **Live:** in `processTelemetry`, nachdem `gy`/`yaw`/`speed` vorliegen:
  `state.drift = RasiDrift.analyze({ yawRate: state.imu.yaw, latAccel: gy, speed }, driftOpts)`
  und `state.charts.driftIndex.push(state.drift.index ?? 0)` (+ Trim).
- **Anzeige (D3):** Drift-Status als farbiges Badge + Indexwert in der
  bestehenden **G-Kraft-KPI-Sub-Zeile** (mirror der `kYaw`/`kMtemp`-Erweiterung
  aus Phase 5): z.B. `· Drift <b id="kDrift">–</b>` mit Status-Klasse
  (`grip`=neutral, `oversteer`=warn, `understeer`=info, `counter`=alarm). Kein
  neuer KPI-Block. Optional Index-Spur auf dem bestehenden G-Chart (rechte
  Achse, gleiches Dual-Axis-Muster wie `yaw`).

### 5.3 Drift-Replay-Auswertung (D4)

- Beim Laden/Abspielen einer Aufnahme rechnet das Dashboard `RasiDrift.analyze`
  über die Sample-Sequenz und `RasiDrift.summarize` für die Statistik.
- **Anzeige:** Drift-Zeitanteil (%) + stärkster Index im Replay-/Nachbericht-
  Bereich; Drift-Phasen werden auf der bestehenden Replay-Zeitleiste markiert
  (gleiche Markierungs-Mechanik wie vorhandene Replay-Overlays).
- **Voraussetzung:** Recorder/Replay reichen `yaw`/`gy`/`speed` pro Sample
  durch. Der Plan **prüft** das zuerst (Grep/Read in `replay.js`/Recorder-Pfad)
  und ergänzt die Durchreichung additiv nur, falls nötig.

### 5.4 Frame v2 (`frame.py`, Phase 19)

- `FRAME_VER = 2`. Ein zusätzliches `int16`-Feld `roll` (Roll-Rate Gyro-X,
  °/s ×10, geklemmt ±3276.7 — deckt ±250 °/s mühelos), **direkt nach `yaw`**
  eingefügt: `FMT = "<BHHHhhhhhiiHHHBbBB"` (fünftes `h` nach den vier
  bestehenden gx/gy/gz/yaw), `SIZE = 35`.
- `pack`: `roll = _clamp(_i(_f(d.get("roll")) * 10.0), -32768, 32767)` (sättigt,
  wirft nie — wie alle Felder). `unpack`: `out["roll"] = roll / 10.0`.
- Backward-compat ist **kein** In-Frame-Thema (festes Layout): Schutz kommt aus
  `FRAME_VER`+Längenprüfung. Tests in §6.

### 5.5 Sender-Wiring (`sender.py`, Phase 19)

- `IMU`: neues geglättetes Feld `self._roll_rate`; in `update()` zusätzlich
  `gxr` aus `self._mpu.gyro` mit demselben `alpha`-EMA glätten (heute wird
  `_gxr` verworfen). Neue Property `roll_rate`. Kein Kalibrier-Offset (wie
  `az`/`yaw`).
- Sende-Schleife: `packet["roll"] = round(imu.roll_rate, 1)` in **jedem** Paket
  (wie `gz`/`yaw`). Ohne MPU bleibt `roll = 0.0` (early return unverändert).
- **R3 (optional):** `mpu6050.py` `ACCEL_CONFIG = 0x08` (±4 g) und
  `ACCEL_SCALE_4G = 8192.0`; `IMU` nutzt die neue Skalierung. Eigene Task,
  separat abnehmbar.

### 5.6 Attitude-Modul (`attitude.js`, Phase 19)

Reines UMD-Modul (Komplementärfilter + Abhebe-Erkennung), deterministisch:

```js
// Ein Fusionsschritt. Liefert den neuen Rollwinkel in Grad.
//   prevRollDeg : letzter Rollwinkel (°)
//   rollRateDps : Roll-Rate (°/s, Gyro-X)
//   gy, gz      : Accel-Achsen (g) für die Schwerkraft-Referenz
//   dtSec       : Zeitschritt (s), geklemmt gegen Ausreißer
//   alpha       : Gyro-Gewicht (Default 0.98)
RasiAttitude.rollStep(prevRollDeg, rollRateDps, gy, gz, dtSec, alpha) → number

// Abhebe-Event mit Hysterese (zustandsbehaftet über ein übergebenes State-Objekt).
//   st: { active } ; thr: { angleDeg, rateDps, hystDeg }
RasiAttitude.wheelLift(st, rollDeg, rollRateDps, thr) → {
  active,   // true während eines Abhebe-Events
  onset     // true im Sample, in dem das Event startet
}
```

**Mathematik:**
- Schwerkraft-Referenz `accelRoll = atan2(gy, gz) · 180/π`.
- Komplementär: `roll = alpha·(prevRollDeg + rollRateDps·dtSec) + (1−alpha)·accelRoll`.
  Kurzfristig folgt der Winkel der Gyro-Integration (α≈0.98), langsam korrigiert
  Accel die Drift. **Grenze (dokumentiert):** in Dauerkurve ist `accelRoll`
  durch Zentripetal-`gy` verzerrt → der Winkel kann driften; deshalb ist die
  **Roll-Raten-Spitze** der zuverlässigere Momentan-Indikator fürs Abheben.
- `dtSec` aus Paket-Zeitstempel-Differenz, gegen Lücken/Aussetzer geklemmt
  (z.B. auf [0.01, 0.5] s).
- **Abheben:** Event `active`, wenn `|rollDeg| > thr.angleDeg` **und**
  `|rollRateDps| > thr.rateDps`; Ende erst, wenn `|rollDeg| < angleDeg − hystDeg`
  (Hysterese gegen Flackern). Defaults feld-kalibrierbar
  (`angleDeg` z.B. 12°, `rateDps` z.B. 60°/s, `hystDeg` 3°).

### 5.7 Attitude-Verdrahtung & UI (`rasicross.js`, HTML, Phase 19)

- **State:** `state.attitude = { rollDeg:0, lift:false, liftState:{active:false} }`;
  Ringpuffer `state.charts.roll`; Null-Kalibrier-Offset analog zur bestehenden
  IMU-Kalibrierung (Settings „Rollwinkel nullen" im Stand).
- **Live (R6):** in `processTelemetry` `state.attitude.rollDeg =
  RasiAttitude.rollStep(...)`, dann `wheelLift(...)`. Anzeige: Rollwinkel-Wert/
  einfacher Neigungs-Indikator (CSS-Balken oder Zeiger) im Live-Tab; bei
  `onset` eine auffällige **„LIFT!"**-Warnung (gleiche Toast/Overlay-Mechanik
  wie Pit-Call/Shift). Roll-Spur optional auf dem G-Chart.
- **Replay (R7):** Rollwinkel-Spur + markierte Abhebe-Events auf der Zeitleiste,
  analog zur Drift-Markierung aus D4.
- **Settings (R8):** Rollwinkel-Schwelle (°) + Raten-Schwelle, Null-Kalibrierung.

### 5.8 Error & edge-case behaviour

| Situation | Verhalten |
|-----------|-----------|
| `speed`/`gy`/`yaw` fehlt oder 0 (Phase 18) | `RasiDrift.analyze` ⇒ `'n/a'`, Index `null`, Badge zeigt `–`. |
| v≈0 / Geradeausfahrt | Gate greift ⇒ `'n/a'`; kein Drift-Fehlalarm im Stand. |
| Vorzeichen Gierrate vs. Querbeschleunigung gegenläufig | `'counter'` (Gegenlenken/Spin) — bewusst als Drift-Sonderfall geflaggt. |
| Alte Aufnahme ohne `roll` (Phase 19) | Roll-Spur leer / Anzeige `--`; Drift-Auswertung unberührt. |
| MPU fehlt am Kart | `roll = 0.0`, Rollwinkel ≈ 0, kein Abhebe-Event; kein Crash/Stall (early return unverändert). |
| Paket-Aussetzer (großer dt) | `dtSec` geklemmt ⇒ kein Winkel-Sprung durch Integration über eine Lücke. |
| v1-Sender ↔ v2-Bridge (oder umgekehrt) | `FRAME_VER`/Längenprüfung weist ab (`bad_ver`/Filter); keine Fehldeutung. Hinweis: beide flashen. |
| ±4 g nicht umgestellt (R3 übersprungen) | Funktioniert; mögliche `gy`-Sättigung bei sehr hoher Querbeschleunigung (dokumentiert). |

## 6. Testing & acceptance

### 6.1 Unit tests

**Phase 18 — `test/drift.test.js`** (`node:test`), Ziel ~8 Fälle:
1. Geradeaus (yaw≈0, latAccel<Gate) ⇒ `'n/a'`, index `null`.
2. Stationärer Grip (yaw ≈ erwartete Gierrate) ⇒ `'grip'`, index ≈ 1.
3. Übersteuern (yaw deutlich > erwartet) ⇒ `'oversteer'`, index > 1+tol.
4. Untersteuern (yaw deutlich < erwartet) ⇒ `'understeer'`.
5. Langsam/Null-Gate (v < minSpeed) ⇒ `'n/a'`.
6. Gegenlenken (Vorzeichen gegenläufig) ⇒ `'counter'`.
7. `expectedYawRate` Einheiten-/Formel-Check gegen einen Handwert.
8. `summarize` über eine gemischte Sequenz: korrekte `driftPct`/`maxIndex`.
   NaN/0/negativ ⇒ kein Wurf.
JS-Testzahl: 52 → ~60.

**Phase 19 — `test/attitude.test.js`** (`node:test`), Ziel ~7 Fälle:
1. Statische Neigung (rollRate=0) ⇒ Winkel konvergiert gegen `atan2(gy,gz)`.
2. Reine Rotation (gy=0,gz=1, konstante rollRate) ⇒ Winkel integriert ~linear.
3. dt-Klemmung bei großer Lücke ⇒ kein Sprung.
4. Abhebe-Onset, wenn Winkel- **und** Raten-Schwelle überschritten.
5. Kein Onset, wenn nur eine der beiden Schwellen überschritten.
6. Hysterese: Event bleibt `active`, bis Winkel < angleDeg−hystDeg.
7. α-Grenzfälle (0 ⇒ rein Accel, 1 ⇒ rein Gyro).

**Phase 19 — `test/test_frame.py`** Ergänzungen (`unittest`):
- `pack`/`unpack` Round-Trip mit `roll` (Wert + Vorzeichen, ×10-Skalierung).
- `FRAME_VER == 2`, `SIZE == 35`.
- v1-Buffer (Version 1 / falsche Länge) ⇒ `{'_err': 'bad_ver'|'bad_len'}`.
- `roll` fehlt im Dict ⇒ 0.0 (Default), kein Wurf.
Python-Testzahl: 34 → ~38.

### 6.2 Static / lint

- `node --check geo.js replay.js drift.js attitude.js rasicross.js main.js preload.js`.
- ESLint clean: `drift.js`/`attitude.js` als Globals in `eslint.config.js`
  deklarieren (analog `RasiTiles`/`DomTargets`).
- Neue `.js` in `package.json` `build.files` **und** als `<script>` vor
  `rasicross.js` in `RasiCross_Telemetry.html`.

### 6.3 ESP firmware (Phase 19)

`python -m py_compile sender.py bridge.py esp_libs/*.py` grün; `unittest`-
Baseline 34 → ~38 (frame). Runtime nur per Hardware-Check.

### 6.4 Hardware / manual acceptance checklist

**Phase 18 (Dashboard-only — kein ESP-Flash):**
1. Demo/Live: bei sauberer Kurvenfahrt zeigt das Drift-Badge `grip` (Index ~1).
2. Provoziertes Übersteuern (Heck kommt) ⇒ Badge `oversteer`, Index > 1.
3. Geradeaus/Stand ⇒ `n/a`, kein Fehlalarm.
4. Aufnahme abspielen ⇒ Drift-Zeitanteil + max Index plausibel; Phasen markiert.

**Phase 19 (nach Flash beider ESPs mit `frame.py` v2 + `sender.py`):**
1. Regression: `gx`/`gy`/`gz`/`yaw`/`speed`/`rpm`/Batterie unverändert; Bridge
   empfängt v2-Frames (kein `bad_*`).
2. `roll`: Kart im Stand ⇒ Roll-Rate ≈ 0; um die Längsachse kippen ⇒ Roll-Rate
   mit korrektem Vorzeichen, Rückkehr gegen 0.
3. Rollwinkel: bekannte statische Neigung (z.B. 15° Keil) ⇒ angezeigter Winkel
   ≈ 15°; Vorzeichen stimmt.
4. Abheben: an Rampe/Bordstein kurveninneres Räderpaar anheben ⇒ „LIFT!"-Warnung
   feuert; auf der Geraden/leichter Kurve nicht.
5. No-MPU: ohne MPU ⇒ `roll=0`, Winkel ≈ 0, keine Warnung, kein Stall.
6. (Falls R3) ±4 g: harte Kurve clippt `gy` nicht mehr; `gx`/`gy` im Alltag
   weiterhin plausibel.
7. Byte-Budget: geloggte `payload bytes` < 250 (Frame 35 B + JSON-Overhead nur
   intern; Funk nutzt den Binär-Frame).

### 6.5 Self-review checklist (phase plan)

- Spec coverage: jedes D1–D6 (Phase 18) bzw. R1–R9 (Phase 19) auf ≥ 1 Task
  abgebildet.
- Placeholder-Scan: kein `TBD`/`TODO`/`placeholder`.
- Namens-Konsistenz: `RasiDrift`/`RasiAttitude`, `state.drift`/`state.attitude`,
  DOM-ids (`kDrift`, …), Paket-Key `roll` — je einmal benannt, verbatim
  wiederverwendet.
- Frame: `FRAME_VER`/`SIZE`/`FMT` konsistent zwischen `frame.py` und Tests;
  ESP-NOW-Budget < 250 B; additiv/backward-compat dokumentiert.
- CRLF: Edits gegen frisch gelesene Anker; Grep-Tool zur Verifikation;
  `__pycache__` vor `git status` löschen; Plan-Doc/`​.claude/` nie mit-committen
  außer im expliziten Plan-Commit.

## 7. Phase map

| Phase | Scope | Files |
|-------|-------|-------|
| **18** (dieser Spec, Teil 1) | Drift-Erkennung (Dashboard-only) | `drift.js`, `test/drift.test.js`, `rasicross.js`, `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js` |
| **19** (dieser Spec, Teil 2) | Rollwinkel / Abheben (Firmware v2 + Dashboard) | `frame.py`, `test/test_frame.py`, `sender.py`, `mpu6050.py` (R3), `attitude.js`, `test/attitude.test.js`, `rasicross.js`, `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js` |

Vorherige Phasen (1–17) auf `main`/aktuellem Branch. Phase 18 wird zuerst
geplant/umgesetzt; Phase 19 baut additiv darauf auf. Gyro-Y/Pitch (vorne-hinten-
Abheben) und der Schwimmwinkel β bleiben für eine spätere Phase offen.

## 8. Open questions

- **R3 (±4 g):** Standardmäßig empfohlen und als eigene, überspringbare Task
  geführt. Endgültige Zustimmung wird im Phase-19-Plan / Hardware-Check
  eingeholt — Phase 19 funktioniert auch ohne.
- **Vorzeichen-/Einbau-Orientierung** des MPU-6050 (Gyro-X/-Z, Querbeschleu­
  nigung) wird beim Hardware-Check festgelegt und über die bestehende
  IMU-Kalibrier-/Settings-Struktur abgebildet; keine feste Polaritätsannahme
  im Code.
