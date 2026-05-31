# RasiCross — Drift-System überarbeiten (Härtung + Glättung + UX)

**Datum:** 2026-05-31
**Branch:** `feat/tab-redesign-pitwall`
**Status:** freigegeben (Brainstorming abgeschlossen); Implementierungsplan ausstehend
**Bezug:** baut auf Phase 18 (`drift.js`) und dem Drift-Pfeil-3D-Follow-up auf;
ursprünglicher Spec `2026-05-30-drift-rollover-detection-design.md`.

---

## 1. Ziel

Das bestehende Drift-System (Phase 18, Gierraten-Index) **überarbeiten**, ohne
die Methode zu ersetzen oder Firmware anzufassen. Drei zusammenhängende
Verbesserungen, alle **rein im Dashboard** und damit sofort auch auf
bestehenden Aufnahmen wirksam:

1. **Methode härten** — den Gierraten-Index beibehalten (12,5 Hz, GPS-unabhängig),
   aber die mounting-abhängige Vorzeichen-/Spin-Logik robust machen.
2. **Stabilisieren** — Index-EMA + Status-Hysterese + Counter-Entprellung gegen
   das heutige Flackern von Badge/Pfeil.
3. **UX schärfen** — klarere Badge-Labels mit Richtungshinweis, ruhiger Wert,
   schärfere Semantik des 3D-Pfeils.

Bewusst **nicht** in diesem Durchgang: GPS-Schwimmwinkel β, Replay-Auswertung
ausbauen, Phase 19 (Rollwinkel/Abheben, braucht Firmware). Siehe §7.

## 2. Verifizierte Ausgangslage

- **Methode heute (`drift.js`):** `analyze({yawRate, latAccel, speed}, opts)` →
  `{status, index, expectedYaw}`. `index = |yaw| / ω_exp`, `ω_exp = (|a_lat|·g)/v`.
  Gate: `speed < minSpeedKmh` **oder** `|latAccel| < minLatG` ⇒ `n/a`. Status:
  `yaw·lat < 0` ⇒ `counter`; `index > 1+tol` ⇒ `oversteer`; `index < 1−tol` ⇒
  `understeer`; sonst `grip`. **Pur, zustandslos, wirft nie.** 8 Unit-Tests grün.
- **Schwachstelle 1 — Vorzeichen-Inkonsistenz:** `gy` wird kalibriert
  (`swapG`/`invertGy`, `rasicross.js` ~`:467‑469`), `yaw` geht **roh** in den
  `counter`-Check (`drift.js:43`). Je nach IMU-Einbaulage feuert „Spin" falsch.
- **Schwachstelle 2 — Rauschen/Flackern:** per-Sample-Klassifikation ohne
  Glättung/Hysterese; nahe der Gate-Schwelle (kleines `a_lat`, kleines `ω_exp`)
  springt der Quotient → Badge-Zahl und Status zappeln.
- **Schwachstelle 3 — Methoden-Grenze (akzeptiert, dokumentiert):** `a_lat = v·ω`
  gilt nur für stationäre Kurven mit kleinem Schwimmwinkel; bei großem
  Schwimmwinkel / Schräglage (Schwerkraft leckt in `gy`) ist der Index verzerrt.
  Volle Korrektur bräuchte Rollwinkel (Phase 19) → bleibt offen.
- **GPS ist zu langsam für transiente Drifts:** `UART2 @ 9600 Baud`, NMEA via
  `micropyGPS`; der Sender **rekonfiguriert die Rate nicht** (keine
  `$PMTK`/`$PUBX`-Kommandos) ⇒ Default ≈ **1 Hz**. Telemetrie/IMU laufen mit
  `SEND_MS = 80` ⇒ **12,5 Hz**; `lat`/`lon` werden pro Frame ~12× wiederholt.
  Ein Drift-Event (~0,5–2 s) hätte bei 1‑Hz-GPS nur 1–2 Stützpunkte. **β wird
  daher verworfen** (wie im Ursprungs-Spec).
- **Aufnahme speichert das ROH-Paket** (`recordPacket`, `rasicross.js` ~`:426‑429`:
  `Object.assign({}, d, { t_rel, _wall })`) — rohes `yaw`/`gy`. Korrektur gehört
  in die Auswertung, nicht in die Aufnahme. ✅
- **Replay-Wiedergabe läuft durch `processTelemetry`** (`feedReplayPacket →
  processTelemetry`, ~`:3409`) ⇒ Badge/3D-Pfeil erben Kalibrierung + Glättung
  beim Abspielen automatisch.
- **Latenter Replay-Bug:** die Aggregat-Statistik beim Laden (`enterReplay`,
  ~`:3457‑3460`) ruft `RasiDrift.summarize/driftSpans(parsed.packets, …)` mit
  **rohen** `p.yaw`/`p.gy` — wendet also `swapG`/`invertGy` **nicht** an. Der
  neue `invertYaw`-Fix wird deshalb als gemeinsame Eingangs-Normalisierung für
  Live **und** Replay gebaut und behebt zugleich diese bestehende Lücke.
- **Kalibrierung** (`state.calibration`, ~`:48`) wird via `saveData`/`Object.assign`
  automatisch persistiert/geladen. **Keine neue `.js`-Datei** ⇒
  `package.json`/`eslint.config.js`/Script-Tags unverändert.

> Zeilennummern sind **indikativ** (CRLF-Repo); bei der Umsetzung pro Edit frisch
> lesen und auf Text ankern.

## 3. Locked decisions

| Thema | Entscheidung |
|---|---|
| Methode | Gierraten-Index **behalten & härten** — kein GPS-β, kein Methodenwechsel. |
| Vorzeichen | Mounting-sicher über neuen `invertYaw`-Kalibrierschalter. |
| Stabilität | Index-**EMA** + Status-**Hysterese** + Counter-**Entprellung**. |
| Architektur | Glättung als **purer Reducer `smoothStep(state, raw, opts)`** in `drift.js`; State explizit durchgereicht (Muster: `gViewReducer`/`kartModelYawReducer`/`yawIntegrate`, `wheelLift(st,…)`). `analyze` bleibt unverändert. |
| Replay | Anzeige unverändert; bekommt die gemeinsame Eingangs-Normalisierung (behebt `swapG`/`invertGy`-Lücke + `invertYaw`). |
| Settings | `tol`/`minSpeedKmh`/`minLatG` bleiben einstellbar; `smooth`/`hyst`/`counterHold` sind **feste Defaults** (keine neue UI). |
| Badge-Wert | geglätteter **Index** (nicht „%-Abweichung"). |
| 3D-Pfeil | **kein** Understeer-Pfeil; Länge ∝ Abweichung vom Grip. |

## 4. Detailliertes Design

### 4.1 Gemeinsame Eingangs-Normalisierung (`rasicross.js`)

Ein Helper erzeugt aus einem Roh-Paket die Drift-Eingänge **identisch** für Live
und Replay-Aggregat:

```js
function driftInputs(d, cal) {            // cal = state.calibration
  let gx = (Number(d.gx) || 0) - cal.gxZero;
  let gy = (Number(d.gy) || 0) - cal.gyZero;
  if (cal.swapG) { const t = gx; gx = gy; gy = t; }
  if (cal.invertGy) gy = -gy;
  let yaw = Number(d.yaw) || 0;
  if (cal.invertYaw) yaw = -yaw;          // NEU — paart yaw mit der gy-Kalibrierung
  return { yawRate: yaw, latAccel: gy, speed: Math.max(0, Number(d.speed) || 0) };
}
```

- Live: in `processTelemetry` statt der heutigen Inline-Berechnung. `state.imu.yaw`
  wird auf den **vorzeichen-korrigierten** `yaw` gesetzt (der 3D-Pfeil nutzt
  `imu.yaw` für die Richtung → konsistent mit der Analyse).
- Replay-Aggregat: `parsed.packets` werden vor `summarize`/`driftSpans` durch
  `driftInputs` gemappt (Kopie mit korrigierten `yaw`/`gy`, `t_rel` erhalten),
  damit `summarize`/`driftSpans` unverändert bleiben.

### 4.2 `drift.js` — purer `smoothStep`-Reducer (neu)

`analyze`/`expectedYawRate`/`summarize`/`driftSpans` bleiben **unverändert**.
Neu hinzu (pur, deterministisch, wirft nie):

```js
var SMOOTH_DEFAULTS = { smooth: 0.6, hyst: 0.15, counterHold: 3 };

function smoothInit() { return { idxEma: null, status: 'n/a', counterRun: 0 }; }

// Vorheriger Glättungs-State + rohes analyze()-Ergebnis -> neuer State.
// Ausgabe für die UI: state.status (entprellt) und state.idxEma (geglättet).
function smoothStep(st, raw, opts) {
  st = st || smoothInit();
  raw = raw || {};
  var o = opts || {};
  var a    = o.smooth      == null ? SMOOTH_DEFAULTS.smooth      : o.smooth;
  var hyst = o.hyst        == null ? SMOOTH_DEFAULTS.hyst        : o.hyst;
  var hold = o.counterHold == null ? SMOOTH_DEFAULTS.counterHold : o.counterHold;
  var tol  = o.tol         == null ? DEFAULTS.tol                : o.tol;

  // Gerade/langsam: Drift-Status sinnlos -> reset.
  if (raw.status === 'n/a' || raw.index == null || !isFinite(Number(raw.index))) {
    return { idxEma: null, status: 'n/a', counterRun: 0 };
  }

  var rawIdx = Number(raw.index);
  var idxEma = st.idxEma == null ? rawIdx : a * st.idxEma + (1 - a) * rawIdx;   // EMA

  // Counter-Entprellung: Run hoch bei 'counter', runter sonst (geklemmt 0..hold).
  var run = st.counterRun + (raw.status === 'counter' ? 1 : -1);
  if (run < 0) run = 0;
  if (run > hold) run = hold;
  var counterActive = st.status === 'counter' ? run > 0 : run >= hold;

  var status;
  if (counterActive) {
    status = 'counter';
  } else if (st.status === 'oversteer') {
    status = idxEma > 1 + tol - hyst ? 'oversteer' : (idxEma < 1 - tol ? 'understeer' : 'grip');
  } else if (st.status === 'understeer') {
    status = idxEma < 1 - tol + hyst ? 'understeer' : (idxEma > 1 + tol ? 'oversteer' : 'grip');
  } else { // grip / counter-Ausstieg / n/a -> frische Klassifikation
    status = idxEma > 1 + tol ? 'oversteer' : (idxEma < 1 - tol ? 'understeer' : 'grip');
  }
  return { idxEma: idxEma, status: status, counterRun: run };
}
```

Verhalten:
- **EMA** `smooth = 0.6` (Anteil Vorwert) ⇒ τ ≈ 160 ms bei 12,5 Hz: Sample-Rauschen
  weg, kaum Lag. Erster gültiger Sample seedet den EMA.
- **Hysterese** `hyst = 0.15` (Index-Einheiten, Default `tol = 0.25`): Übersteuern
  rein bei `idxEma > 1.25`, raus erst `< 1.10`; Untersteuern rein `< 0.75`,
  raus `> 0.90`. Kein Pendeln an der Grenze.
- **Counter** braucht `counterHold = 3` anhaltende Gegen-Samples (~240 ms) zum
  Einrasten und löst, wenn der Run auf 0 fällt.
- `tol` kommt aus `state.settings.drift` (bleibt einstellbar). `smooth`/`hyst`/
  `counterHold` sind feste Defaults; per `opts` nur für Tests überschreibbar.
- Export ergänzen: `smoothStep`, `smoothInit` (UMD-Namespace `RasiDrift`).

### 4.3 `rasicross.js` — Verdrahtung

- `state.calibration.invertYaw = false` (Default-Objekt ~`:48`) ⇒ auto-persistiert
  und -geladen über die bestehende `saveData`/`Object.assign`-Mechanik.
- `state.driftSmooth = RasiDrift.smoothInit()`; in **allen** Reset-Pfaden
  mitführen (Haupt-Reset ~`:3382` neben `state.drift`, `resetReplayDerived`
  ~`:3368`).
- `processTelemetry`:
  ```js
  const di  = driftInputs(d, state.calibration);
  state.imu.yaw = di.yawRate;                       // vorzeichen-korrigiert
  const raw = RasiDrift.analyze(di, state.settings.drift);
  state.driftSmooth = RasiDrift.smoothStep(state.driftSmooth, raw, state.settings.drift);
  state.drift = { status: state.driftSmooth.status, index: state.driftSmooth.idxEma };
  ```
- `state.charts.driftIndex` plottet jetzt den **geglätteten** Index
  (`state.drift.index == null ? 0 : …`, wie bisher).
- Replay-Aggregat (`enterReplay`): `parsed.packets` durch `driftInputs` mappen,
  dann `summarize`/`driftSpans` auf der gemappten Kopie.

### 4.4 UX — Badge `#kDrift`

Geglätteter Status + Richtungs-Glyph + ruhiger Wert. Reine `textContent`/`color`-
Logik in `renderDriftBadge` (~`:559`); **kein HTML-Umbau** des Badges nötig.
Glyph aus `sign(state.imu.yaw)` (nach `invertYaw` konsistent).

| Status | Label | Farbe (vorhanden) | Glyph | Beispiel |
|---|---|---|---|---|
| n/a | `–` | neutral | — | `–` |
| grip | `Grip` | grün | — | `Grip` |
| oversteer | `Drift` | amber | ← / → | `Drift → 1.4` |
| understeer | `Schiebt` | blau | — | `Schiebt 0.6` |
| counter | `Spin` | rot | ← / → | `Spin ←` |

Wert = `idxEma.toFixed(1)` (durch EMA ruhig). Farb-Map (`DRIFT_COLOR`) bleibt.

### 4.5 `karts3d.js` — `driftArrowSpec` schärfen

Der Pfeil wird zum **Abweichungs-vom-Grip-Indikator** (heute zeigt er bei Grip
fälschlich halbe Länge):

- `severity = clamp(|index − 1|, 0, SEV_MAX)` mit `SEV_MAX = 1.0`;
  `length = severity / SEV_MAX · maxLen` (mit `minLen`-Floor wie gehabt).
- **Sichtbar nur bei `oversteer` & `counter`** (Rotations-Überschuss / Spin).
  `understeer` ⇒ kein Pfeil (ein Pfeil = Drehung wäre beim Schieben irreführend;
  die Badge-Farbe trägt die Info). `grip`/`n/a` ⇒ unsichtbar.
- Richtung `(dirSign, 0, 0)` mit `dirSign = sign(yawRate)`; Farbe je Status
  (Palette `DRIFT_3D_COLOR` unverändert).
- Konsumiert automatisch den geglätteten `state.drift` (über den bestehenden
  `RasiKart3D.update({ …, drift: state.drift })`-Aufruf ~`:585`).
- Signatur `driftArrowSpec(status, index, yawRate, opts)` bleibt; nur Längen- und
  Sichtbarkeits-Logik ändert sich.

### 4.6 HTML / CSS

- Eine Toggle-Row `setInvertYaw` („Gier invertieren") neben `setInvertGx`/
  `setInvertGy`/`setSwapG` (HTML ~`:3069‑3071`).
- Lesen/Spiegeln analog: Settings-Apply (~`:404‑406`) und Settings-Populate
  (~`:377‑379`).
- **Keine** neue `.js`-Datei ⇒ keine `package.json`/`eslint.config.js`/Script-Tag-
  Änderung.

## 5. Verhaltens-Invarianten & Edge-Cases

| Situation | Verhalten |
|---|---|
| `invertYaw` aus (Default) | Identisch zu heute, abgesehen von Glättung/Hysterese; vorhandene Aufnahmen unverändert lesbar. |
| Gerade/langsam (Gate) | `smoothStep` ⇒ `n/a`, `idxEma = null`, Badge `–`, Pfeil unsichtbar. |
| Einzelner Gegen-Sample (Rauschen) | **kein** sofortiges `Spin` (Entprellung `counterHold`). |
| Status nahe Grenze | Hysterese verhindert Pendeln oversteer↔grip↔understeer. |
| NaN/Junk-Eingang | `analyze` und `smoothStep` ⇒ `n/a`, kein Wurf. |
| Replay laden | Aggregat-Statistik jetzt **mit** `swapG`/`invertGy`/`invertYaw` (vorher roh). |
| Replay abspielen | Badge/Pfeil über `processTelemetry` inkl. Glättung; `state.driftSmooth` startet frisch (Reset in `resetReplayDerived`). |
| Schräglage/großer Schwimmwinkel | Index bleibt verzerrt (Methoden-Grenze, dokumentiert) — volle Korrektur erst mit Phase 19. |

`analyze`/`expectedYawRate`/`summarize`/`driftSpans` bleiben verhaltensgleich;
alle bestehenden Drift-Tests müssen grün bleiben.

## 6. Testing & Abnahme

### 6.1 Unit-Tests (`node:test`)

**`test/drift.test.js`** (+~6 Fälle, bestehende 8 unverändert grün):
1. `smoothInit()` liefert `{ idxEma:null, status:'n/a', counterRun:0 }`.
2. `raw.status === 'n/a'` (oder `index null`/`NaN`) ⇒ State-Reset auf `n/a`.
3. **EMA-Konvergenz:** wiederholtes Füttern eines konstanten `index` ⇒ `idxEma`
   nähert sich diesem Wert; erster Sample seedet exakt.
4. **Hysterese:** ist `status === 'oversteer'`, hält ein einzelner Dip auf
   `idxEma` zwischen `1.10` und `1.25` den Status; erst `< 1.10` ⇒ `grip`.
5. **Counter-Entprellung:** 1× `counter` ⇒ noch nicht `'counter'`; nach
   `counterHold` aufeinanderfolgenden ⇒ `'counter'`; löst bei Run 0.
6. NaN/Junk ⇒ kein Wurf, sauberer Reset.

**`test/karts3d.test.js`** — `driftArrowSpec` an neue Semantik anpassen/ergänzen:
- `grip` (index≈1) ⇒ `visible:false` (Pfeil verschwindet).
- `understeer` (index<1) ⇒ `visible:false` (kein Understeer-Pfeil).
- `oversteer`: Länge ∝ `|index−1|`, größeres `|index−1|` ⇒ länger; Clamp bei
  `SEV_MAX`.
- `counter`: `dirSign` kippt mit Vorzeichen von `yawRate` (−1 vs +1); Farbe rot.
- Farben je Status korrekt; `n/a`/fehlender Status ⇒ `visible:false`.

### 6.2 Statik / Lint

- `node --check geo.js replay.js drift.js karts3d.js rasicross.js main.js preload.js`.
- ESLint clean; `drift.js`/`karts3d.js` sind bereits als Globals deklariert —
  keine neue Datei, keine `eslint.config.js`/`package.json`/Script-Tag-Änderung.
- `node --test` (auto-discovers `test/`) grün; aktuelle Baseline bei Umsetzung
  frisch ermitteln (nicht aus alter Memory übernehmen) und um die neuen Fälle
  erhöht halten.

### 6.3 Manuelle Abnahme (Dashboard-only, kein ESP-Flash)

1. Saubere Kurvenfahrt (Demo/Live) ⇒ Badge `Grip`, Index ~1, **kein** Flackern;
   3D-Pfeil bei Grip unsichtbar.
2. Provoziertes Übersteuern ⇒ Badge `Drift` mit Richtungs-Glyph; 3D-Pfeil wächst
   in Dreh-Richtung; Status springt nicht zurück bei kleinem Zucken (Hysterese).
3. Geradeaus/Stand ⇒ `n/a`, kein Fehlalarm.
4. **`invertYaw`-Kalibrierung:** zeigt eine saubere Kurve fälschlich `Spin`, kippt
   der Schalter „Gier invertieren" das auf `Drift`/`Grip`; Einstellung übersteht
   Neustart (persistiert).
5. Aufnahme abspielen ⇒ Drift-%/max plausibel und **konsistent** zur Live-Anzeige
   (gleiche Kalibrierung); Strip markiert die Phasen.

## 7. Scope / YAGNI & Folge-Phasen

**In diesem Durchgang nicht enthalten (bewusst):**
- **GPS-Schwimmwinkel β** — 1‑Hz-GPS zu grob für transiente Drifts (§2).
- **Replay-Auswertung ausbauen** (stärkste Phasen/Dauer/pro-Kurve) — Anzeige
  bleibt `%·max` + Strip; nur Korrektheits-Fix.
- **Glättungs-/Hysterese-Settings in der UI** — feste Defaults.
- **Phase 19 — Rollwinkel/Abheben** — braucht Frame v2 + `sender.py`/`mpu6050.py`
  + beide ESPs flashen + neues `attitude.js`. Bleibt die bereits gespeccte,
  additive Folge-Phase (`2026-05-30-drift-rollover-detection-design.md`, Teil 2).

## 8. Dateien

| Aktion | Pfad | Verantwortung |
|---|---|---|
| Modify | `drift.js` | `SMOOTH_DEFAULTS`, `smoothInit`, pure `smoothStep`; Export. `analyze` & Co. unverändert. |
| Modify | `test/drift.test.js` | `smoothStep`-Fälle (EMA, Hysterese, Counter-Entprellung, Reset, Junk). |
| Modify | `karts3d.js` | `driftArrowSpec`: Länge ∝ `|index−1|`, Sichtbarkeit nur oversteer/counter. |
| Modify | `test/karts3d.test.js` | `driftArrowSpec`-Fälle an neue Semantik anpassen. |
| Modify | `rasicross.js` | `driftInputs`-Helper; `invertYaw` in `calibration`; `state.driftSmooth` + Resets; Live-Pipe; Replay-Aggregat-Map; Badge-Glyph in `renderDriftBadge`. |
| Modify | `RasiCross_Telemetry.html` | Toggle-Row `setInvertYaw`. |

Keine neuen Dateien ⇒ `package.json`/`eslint.config.js` unverändert.
