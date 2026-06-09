# Phase 21 — G-Meter + 3D-Modell Redesign mit Kippfunktion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2D-G-Meter und 3D-Kart nutzen denselben fusionierten Rollwinkel (`state.attitude.rollDeg` + `state.attitude.over`) wie die Kippfunktion; das 3D-Kart kippt zum echten Roll mit rotem Umkipp-Boden-Glühen, das 2D-Meter bekommt künstlichen Horizont + Bank-Ring, und der flache Roll-Balken wird zu einem kompakten Readout.

**Architecture:** `karts3d.js` bekommt zwei reine Helfer (`resolveRollRad`, `rolloverGlowAlpha`, TDD) und nutzt sie im WebGL-`update()`; `rasicross.js` übergibt `rollDeg`/`over` an `RasiKart3D.update`, erweitert `drawGMeter` um Horizont + Bank-Ring und vereinfacht `renderRollBar` zum Readout. Reine Visualisierung, keine Telemetrie-/Protokoll-Änderung.

**Tech Stack:** Vanilla-JS-UMD (`karts3d.js` ES5 + `node:test`), Three.js r152 (gebundelt), Electron-Dashboard (Canvas 2D + DOM/CSS). Keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-06-09-gmeter-3d-kippfunktion-design.md`.

---

## Working Directory & Conventions

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Git als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- **CRLF-Repo:** vor jedem Edit die Zielregion frisch lesen, auf **Text** ankern (Zeilennummern sind indikativ). Verifikation mit dem **Grep-Tool** (nicht Shell-grep).
- `karts3d.js` ist **ES5** (`var`, keine Arrow/`let`/`const`/`??`); reine Helfer am Dateianfang, DOM/WebGL danach (gated `typeof THREE`). `rasicross.js` nutzt `let`/`const`.
- DOM/WebGL/Canvas-Wiring ist **nicht** unit-getestet → `node --check` + Grep + manueller Smoke. Nur die reinen Helfer in `karts3d.js` werden mit `node:test` getestet.
- Pro Task **ein Commit**; nur die genannten Dateien `git add` (nie `git add .`/`.claude/`/Plan-Docs außer dem finalen Plan-Commit). Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verifikations-Rezept: `node --check rasicross.js karts3d.js`, `node --test` (auto-discovers `test/`), `npm run lint`. Python wird nicht angefasst.
- **Baselines (frisch):** `node --test` = **95**. Nach Task 1+2: **97** (2 neue reine-Helfer-Tests). Keine neue `.js`-Datei → keine `package.json`/`eslint.config.js`-Änderung.

## Locked decisions

- **Eine Roll-Quelle:** beide Ansichten lesen `state.attitude.rollDeg` (fusioniert, inkl. `invertRollRate`) + `state.attitude.over`. Das 3D-`update()` bekommt `rollDeg`/`over` als **optionale** Felder; fehlen sie, Fallback auf `rollFromG` (abwärtskompatibel).
- **Pitch bleibt aus Gx** (`pitchFromG`), Yaw bleibt integriert. Nur die Roll-Achse wechselt die Quelle.
- **Umkipp-Optik 3D** auf **Szenen-Ebene** (Boden-Glow-Ring + Boden-Tönung), nie über Kart-Materialien → Custom-Modelle bleiben unberührt.
- **2D-Meter:** G-Plot schrumpft auf `w*0.40`, ein **Bank-Ring** bei `w*0.46` (dort wo der Plot-Rand vorher war); Achsenlabels wandern auf den Ring-Radius (Position praktisch unverändert). Künstlicher Horizont in den G-Plot geclippt.
- **Readout:** `#rollInd` verliert `.roll-track`/`#rollMarker`/`.roll-scale`; `#rollVal` + `#rollOver` bleiben. `renderRollBar` bleibt als Funktionsname.

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `karts3d.js` | Reine Helfer `resolveRollRad`, `rolloverGlowAlpha` + Export; `update()` nutzt fusionierten Roll; `_floor`/`_rolloverGlow` in `init`/`update`/`dispose`. |
| Modify | `test/karts3d.test.js` | Tests für `resolveRollRad` + `rolloverGlowAlpha`; Export-Test erweitert. |
| Modify | `rasicross.js` | `renderGauges` übergibt `rollDeg`/`over`; `drawGMeter` Horizont + Bank-Ring; `renderRollBar` → Readout. |
| Modify | `RasiCross_Telemetry.html` | `#rollInd`-Block schlank; CSS-Cleanup (`.roll-track`/`.roll-marker`/`.roll-scale`) + `.roll-cap`. |

**Task-Reihenfolge:** 1 (3D-Roll-Quelle, TDD) → 2 (3D-Umkipp-Glow, TDD) → 3 (2D-Meter Horizont+Ring) → 4 (Readout-Umbau) → 5 (Verifikation + Plan-Doc-Commit).

---

## Task 1: `karts3d.js` — Roll aus der Kippfunktion (`resolveRollRad`, TDD)

**Files:**
- Modify: `karts3d.js`
- Test: `test/karts3d.test.js`
- Modify: `rasicross.js` (Datenfluss)

- [ ] **Step 1: Failing test schreiben** in `test/karts3d.test.js` — nach dem `rollFromG`-Test einfügen:

```js
test('resolveRollRad: fusionierter rollDeg wenn endlich, sonst rollFromG-Fallback', () => {
  // 30 deg -> pi/6 rad, ignoriert Accel
  assert.ok(close(K.resolveRollRad(30, 0, 1, 0), Math.PI / 6, 1e-9));
  // negative Grad
  assert.ok(close(K.resolveRollRad(-45, 0, 0, 1), -Math.PI / 4, 1e-9));
  // fehlend/NaN -> Fallback rollFromG(gx,gy,gz)
  assert.ok(close(K.resolveRollRad(undefined, 0, 1, 0), Math.PI / 2, 1e-9));
  assert.ok(close(K.resolveRollRad(NaN, 0, -1, 0), -Math.PI / 2, 1e-9));
  // Fallback im Stillstand -> 0
  assert.equal(K.resolveRollRad(null, 0, 0, 1), 0);
});
```

Und den Export-Test (`'exports the pure-helper api'`) erweitern — die Namensliste ergänzen:

```js
  for (const n of ['pitchFromG', 'rollFromG', 'yawIntegrate', 'gViewReducer',
                   'computeAutoFitScale', 'kartModelYawReducer', 'driftArrowSpec',
                   'resolveRollRad', 'rolloverGlowAlpha']) {
```

(`rolloverGlowAlpha` wird in Task 2 implementiert; der Export-Test deckt beide ab — er wird erst nach Task 2 grün. Bis dahin schlägt nur der Export-Test fehl, der `resolveRollRad`-Test wird in diesem Task grün.)

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `node --test`
Expected: FAIL — `resolveRollRad`-Test und Export-Test schlagen fehl (`K.resolveRollRad is not a function`).

- [ ] **Step 3: Helfer implementieren** in `karts3d.js` — direkt nach der `rollFromG`-Funktion (nach ihrer schließenden `}`):

```js
// resolveRollRad: bevorzugt den fusionierten Rollwinkel (Grad) wenn endlich,
// sonst Fallback auf accel-basiertes rollFromG. Liefert Radiant. Hält update()
// abwaertskompatibel fuer Aufrufer ohne rollDeg.
function resolveRollRad(rollDeg, gx, gy, gz) {
  var d = Number(rollDeg);
  if (isFinite(d)) return d * Math.PI / 180;
  return rollFromG(gx, gy, gz);
}
```

- [ ] **Step 4: Im Export-Objekt eintragen** (`karts3d.js`, im `api`-Objekt der UMD-Export-IIFE) — nach `rollFromG: rollFromG,`:

```js
    resolveRollRad: resolveRollRad,
```

- [ ] **Step 5: `update()` auf den Helfer umstellen** (`karts3d.js`). Anker — die zwei Zeilen:

```js
  var targetPitch = pitchFromG(gx, gy, gz);
  var targetRoll  = rollFromG(gx, gy, gz);
```

ersetzen durch:

```js
  var targetPitch = pitchFromG(gx, gy, gz);
  var targetRoll  = resolveRollRad(imu.rollDeg, gx, gy, gz);
```

- [ ] **Step 6: Datenfluss in `rasicross.js`** — `renderGauges()`, der `RasiKart3D.update({...})`-Aufruf. Anker:

```js
    window.RasiKart3D.update({
      gx: state.display.gxLerp,
      gy: state.display.gyLerp,
      gz: state.telemetry.gz || 0,
      yaw: state.imu.yaw || 0,
      dtMs: dtMs,
      drift: state.drift
    });
```

ersetzen durch:

```js
    window.RasiKart3D.update({
      gx: state.display.gxLerp,
      gy: state.display.gyLerp,
      gz: state.telemetry.gz || 0,
      yaw: state.imu.yaw || 0,
      dtMs: dtMs,
      drift: state.drift,
      rollDeg: (state.attitude && state.attitude.rollDeg) || 0,
      over: !!(state.attitude && state.attitude.over)
    });
```

- [ ] **Step 7: Tests + Syntax** — `resolveRollRad`-Test grün (Export-Test bleibt rot bis Task 2):

Run: `node --test 2>&1 | grep -E "resolveRollRad|pass|fail"`
Expected: `resolveRollRad`-Test PASS; genau **1** Fail (der Export-Test wegen fehlendem `rolloverGlowAlpha`).

Run: `node --check karts3d.js && node --check rasicross.js`
Expected: kein Output (OK).

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add karts3d.js test/karts3d.test.js rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(3d): kart tilts to fused roll angle (Kippfunktion)

resolveRollRad prefers state.attitude.rollDeg (passed via update), falls
back to rollFromG when absent. renderGauges now forwards rollDeg + over.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `karts3d.js` — 3D-Umkipp-Boden-Glühen (`rolloverGlowAlpha`, TDD)

**Files:**
- Modify: `karts3d.js`
- Test: `test/karts3d.test.js`

- [ ] **Step 1: Failing test schreiben** in `test/karts3d.test.js` — nach dem `resolveRollRad`-Test:

```js
test('rolloverGlowAlpha: 0 wenn nicht over; pulst in [0.25,0.60] wenn over', () => {
  assert.equal(K.rolloverGlowAlpha(false, 1234), 0);
  for (const t of [0, 90, 180, 500, 1000, 4321]) {
    const a = K.rolloverGlowAlpha(true, t);
    assert.ok(a >= 0.25 - 1e-9 && a <= 0.60 + 1e-9, `alpha ${a} out of range @t=${t}`);
  }
  // nicht-endliches t -> als 0 behandelt -> 0.25 + 0.35*0.5 = 0.425
  assert.ok(close(K.rolloverGlowAlpha(true, NaN), 0.425, 1e-9));
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `node --test 2>&1 | grep -E "rolloverGlowAlpha|fail"`
Expected: FAIL — `K.rolloverGlowAlpha is not a function`.

- [ ] **Step 3: Helfer implementieren** in `karts3d.js` — direkt nach `resolveRollRad`:

```js
// rolloverGlowAlpha: Opacity fuer das rote 3D-Umkipp-Boden-Gluehen. 0 wenn
// nicht over; sonst zeit-pulsierend in ~[0.25, 0.60]. Rein/testbar.
function rolloverGlowAlpha(over, tMs) {
  if (!over) return 0;
  var t = Number(tMs) || 0;
  return 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 180));
}
```

- [ ] **Step 4: Export ergaenzen** — im `api`-Objekt nach `resolveRollRad: resolveRollRad,`:

```js
    rolloverGlowAlpha: rolloverGlowAlpha,
```

- [ ] **Step 5: Modul-State-Vars** in `karts3d.js` — bei den `_`-Feldern (nach `var _driftArrow = null;`) ergaenzen:

```js
var _floor = null;          // floor plate (tinted red on rollover)
var _rolloverGlow = null;   // red floor ring, pulsing when `over`
```

- [ ] **Step 6: Bodenplatte als Modul-Ref + Glow-Ring** in `init()`. Anker — der Floor-Block:

```js
  // Floor plate (semi-transparent, gives a visible shadow surface)
  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshBasicMaterial({ color: 0x1a1f2c, transparent: true, opacity: 0.35 })
  );
  floor.rotation.x = -Math.PI / 2;
  _scene.add(floor);
```

ersetzen durch:

```js
  // Floor plate (semi-transparent, gives a visible shadow surface)
  _floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshBasicMaterial({ color: 0x1a1f2c, transparent: true, opacity: 0.35 })
  );
  _floor.rotation.x = -Math.PI / 2;
  _scene.add(_floor);

  // Rollover floor glow: roter Ring auf dem Boden, unsichtbar bis `over`.
  _rolloverGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.9, 40),
    new THREE.MeshBasicMaterial({ color: 0xff5470, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  _rolloverGlow.rotation.x = -Math.PI / 2;
  _rolloverGlow.position.y = 0.012;
  _rolloverGlow.visible = false;
  _scene.add(_rolloverGlow);
```

- [ ] **Step 7: Glow + Boden-Tönung in `update()`**. Anker — der Beginn des Resize-Check-Blocks:

```js
  // Re-fit if the canvas client size or device pixel ratio changed (cheap
```

unmittelbar **davor** einfügen:

```js
  // Umkipp-Optik (Szenen-Ebene, schont Custom-Modelle): roter Boden-Glow-Ring
  // + Boden-Toenung, solange `over`.
  var over = !!imu.over;
  if (_rolloverGlow) {
    _rolloverGlow.visible = over;
    _rolloverGlow.material.opacity = rolloverGlowAlpha(over, now);
  }
  if (_floor) {
    _floor.material.color.setHex(over ? 0x3a1420 : 0x1a1f2c);
  }

```

- [ ] **Step 8: Refs in `dispose()` nullen**. Anker:

```js
  _kartGroup = _arrow = _gzBar = _driftArrow = null;
```

ersetzen durch:

```js
  _kartGroup = _arrow = _gzBar = _driftArrow = null;
  _floor = _rolloverGlow = null;
```

- [ ] **Step 9: Volle Tests + Syntax**

Run: `node --test 2>&1 | tail -5`
Expected: `pass 97`, `fail 0` (resolveRollRad + rolloverGlowAlpha + erweiterter Export-Test alle grün).

Run: `node --check karts3d.js`
Expected: kein Output (OK).

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add karts3d.js test/karts3d.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(3d): pulsing red floor glow on rollover

Scene-level glow ring + floor tint when over=true, driven by the pure
rolloverGlowAlpha helper. Custom kart models stay untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `rasicross.js` — 2D-Meter: künstlicher Horizont + Bank-Ring

**Files:**
- Modify: `rasicross.js` (`drawGMeter`)

DOM/Canvas → nicht unit-getestet; Verifikation per `node --check` + Grep + manueller Smoke.

- [ ] **Step 1: G-Plot verkleinern, Bank-Ring-Radius einführen.** Anker:

```js
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = w * 0.46;
```

ersetzen durch:

```js
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = w * 0.40, rr = w * 0.46;
```

- [ ] **Step 2: Achsenlabels auf den Ring-Radius `rr` setzen.** Anker — der Label-Block:

```js
  ctx.fillText('+Gx', cx, cy - r - lpad);
  ctx.textBaseline = 'top';
  ctx.fillText('−Gx', cx, cy + r + lpad);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('+Gy', cx + r + lpad, cy);
  ctx.textAlign = 'right';
  ctx.fillText('−Gy', cx - r - lpad, cy);
```

ersetzen durch:

```js
  ctx.fillText('+Gx', cx, cy - rr - lpad);
  ctx.textBaseline = 'top';
  ctx.fillText('−Gx', cx, cy + rr + lpad);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('+Gy', cx + rr + lpad, cy);
  ctx.textAlign = 'right';
  ctx.fillText('−Gy', cx - rr - lpad, cy);
```

- [ ] **Step 3: Künstlichen Horizont einfügen** (in den G-Plot geclippt). Anker — die Border-Stroke-Zeilen:

```js
  // Border
  ctx.strokeStyle = css('--bor'); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
```

unmittelbar **danach** einfügen:

```js
  // ── Künstlicher Horizont (Kippfunktion) ──────────────────────
  const rollDeg = Math.max(-90, Math.min(90, (state.attitude && state.attitude.rollDeg) || 0));
  const over = !!(state.attitude && state.attitude.over);
  const rollRad = rollDeg * Math.PI / 180;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-rollRad);
  ctx.fillStyle = over ? 'rgba(255,84,112,.13)' : 'rgba(90,184,255,.10)';
  ctx.fillRect(-r, 0, r * 2, r);
  ctx.strokeStyle = over ? css('--red') : 'rgba(90,184,255,.55)';
  ctx.lineWidth = 1.5 * dpr();
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  ctx.restore();
```

- [ ] **Step 4: Bank-Ring + Zeiger + Umkipp-Zonen einfügen** ans Funktionsende. Anker — die letzten Zeilen von `drawGMeter` (aktueller Dot + Funktionsende):

```js
  ctx.beginPath(); ctx.arc(px, py, 7 * dpr(), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}
```

ersetzen durch:

```js
  ctx.beginPath(); ctx.arc(px, py, 7 * dpr(), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // ── Bank-Ring: Roll-Skala + Zeiger + Umkipp-Zonen ────────────
  const thr = (state.settings.rollover && state.settings.rollover.angleDeg) || 75;
  const a0 = -Math.PI / 2;                 // 0° Roll = oben (12 Uhr)
  const toA = d => a0 + d * Math.PI / 180; // Roll φ -> Canvas-Winkel
  ctx.strokeStyle = css('--bor'); ctx.lineWidth = 2 * dpr();
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  // Umkipp-Zonen ±thr..±90°
  ctx.strokeStyle = over ? css('--red') : 'rgba(255,84,112,.5)';
  ctx.lineWidth = 4 * dpr();
  ctx.beginPath(); ctx.arc(cx, cy, rr, toA(thr), toA(90)); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rr, toA(-90), toA(-thr)); ctx.stroke();
  // Ticks 0/±30/±60
  ctx.strokeStyle = css('--sub'); ctx.lineWidth = 1.5 * dpr();
  [-60, -30, 0, 30, 60].forEach(d => {
    const a = toA(d), c1 = Math.cos(a), s1 = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + c1 * (rr - 5 * dpr()), cy + s1 * (rr - 5 * dpr()));
    ctx.lineTo(cx + c1 * (rr + 4 * dpr()), cy + s1 * (rr + 4 * dpr()));
    ctx.stroke();
  });
  // Zeiger am aktuellen Rollwinkel
  const ap = toA(rollDeg);
  const cpx = cx + Math.cos(ap) * rr, cpy = cy + Math.sin(ap) * rr;
  ctx.fillStyle = over ? css('--red') : css('--green');
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = (over ? 10 : 5) * dpr();
  ctx.beginPath(); ctx.arc(cpx, cpy, 4 * dpr(), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Umkipp-Glow am Hauptkreis
  if (over) {
    ctx.strokeStyle = css('--red');
    ctx.shadowColor = css('--red'); ctx.shadowBlur = 14 * dpr();
    ctx.lineWidth = 2.5 * dpr();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
```

- [ ] **Step 5: Syntax + statische Anker**

Run: `node --check rasicross.js`
Expected: kein Output (OK).

Run (Grep-Tool): Pattern `rr = w \* 0\.46|Bank-Ring|Künstlicher Horizont` in `rasicross.js`
Expected: 3 Treffer (Radius, Ring-Block, Horizont-Block vorhanden).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(gmeter): artificial horizon + bank ring from fused roll

2D G-meter shows a tilting horizon line and an outer bank ring with
ticks, a roll pointer and red rollover zones (>= settings threshold);
red glow when over. G-plot shrinks to make room for the ring.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Readout statt flachem Roll-Balken (HTML + `renderRollBar` + CSS)

**Files:**
- Modify: `RasiCross_Telemetry.html`
- Modify: `rasicross.js` (`renderRollBar`)

- [ ] **Step 1: `#rollInd`-Block schlank machen** (`RasiCross_Telemetry.html`). Zuerst die Region frisch lesen (Grep `id="rollInd"`), dann den Block ankern:

```html
        <div class="roll-ind" id="rollInd" title="Rollwinkel (Umkipp-Warnung ab Schwelle)">
          <div class="roll-track"><i class="roll-marker" id="rollMarker"></i></div>
          <div class="roll-scale"><span>-90°</span><span>0°</span><span>+90°</span></div>
          <div class="roll-val"><b id="rollVal">0°</b> <span id="rollOver" class="roll-over hidden">UMGEKIPPT</span></div>
        </div>
```

ersetzen durch:

```html
        <div class="roll-ind" id="rollInd" title="Rollwinkel (Umkipp-Warnung ab Schwelle)">
          <div class="roll-val"><span class="roll-cap">ROLL</span> <b id="rollVal">0°</b> <span id="rollOver" class="roll-over hidden">⚠ UMGEKIPPT</span></div>
        </div>
```

- [ ] **Step 2: `renderRollBar()` vereinfachen** (`rasicross.js`). Anker:

```js
function renderRollBar() {
  const m = $('rollMarker');
  if (!m) return;
  const deg = Math.max(-90, Math.min(90, (state.attitude && state.attitude.rollDeg) || 0));
  m.style.left = (50 + deg / 90 * 50) + '%';
  const over = !!(state.attitude && state.attitude.over);
  m.classList.toggle('over', over);
  const v = $('rollVal'); if (v) v.textContent = Math.round(deg) + '°';
  const o = $('rollOver'); if (o) o.classList.toggle('hidden', !over);
}
```

ersetzen durch:

```js
function renderRollBar() {
  const v = $('rollVal');
  if (!v) return;
  const deg = Math.max(-90, Math.min(90, (state.attitude && state.attitude.rollDeg) || 0));
  v.textContent = Math.round(deg) + '°';
  const over = !!(state.attitude && state.attitude.over);
  const o = $('rollOver'); if (o) o.classList.toggle('hidden', !over);
}
```

- [ ] **Step 3: CSS aufräumen** (`RasiCross_Telemetry.html`). Per Grep-Tool die Selektoren `\.roll-track|\.roll-marker|\.roll-scale` lokalisieren; deren Regel-Blöcke (nur diese drei, inkl. evtl. `.roll-marker.over`) **entfernen**. `.roll-ind`, `.roll-val`, `.roll-over` **bleiben**. Direkt bei `.roll-val` eine kleine Caption-Regel ergänzen:

```css
.roll-cap{font-family:var(--mono);font-size:9.5px;font-weight:800;letter-spacing:.1em;color:var(--mut)}
```

(Exakter Anker beim Editieren aus dem frischen Read übernehmen — CRLF.)

- [ ] **Step 4: Syntax + statische Anker**

Run: `node --check rasicross.js`
Expected: kein Output (OK).

Run (Grep-Tool) in `RasiCross_Telemetry.html` + `rasicross.js`: Pattern `rollMarker|roll-track|roll-scale`
Expected: **0 Treffer** (vollständig entfernt).

Run (Grep-Tool): Pattern `id="rollVal"|id="rollOver"|roll-cap`
Expected: `rollVal` + `rollOver` (HTML) + `roll-cap` (HTML CSS + Markup) vorhanden.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(roll): flat roll bar -> compact ROLL readout

Roll is now shown in the meter (horizon/ring) and 3D kart; the flat
bar/marker/scale is replaced by a compact 'ROLL n deg' + UMGEKIPPT badge
line. IDs rollVal/rollOver kept; unused CSS removed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Phase-Verifikation + Plan-Doc-Commit

**Files:**
- Add: `docs/superpowers/plans/2026-06-09-21-gmeter-3d-kippfunktion.md` (dieser Plan)

- [ ] **Step 1: Volle Verifikation**

Run: `node --check rasicross.js karts3d.js`
Expected: kein Output (OK).

Run: `node --test 2>&1 | tail -6`
Expected: `pass 97`, `fail 0`.

Run: `npm run lint`
Expected: kein Fehler (exit 0).

- [ ] **Step 2: Manueller Smoke (Nutzer, Electron + Chromium)** — abhaken:
  1. **2D-Meter:** Horizontlinie kippt mit dem realen Rollwinkel; Bank-Zeiger wandert; über Schwelle → Ring-Zone + Glow rot. G-Dot/Trail/Zonen unverändert, Achsenlabels lesbar.
  2. **3D-Kart:** kippt seitlich zum **gleichen** Rollwert wie der 2D-Zeiger; Pitch reagiert weiter auf Bremsen/Gas; Yaw wie bisher.
  3. **Umkipp:** Schwelle überschreiten → 3D-Boden glüht/pulsiert rot, 2D-Glow rot, Readout `⚠ UMGEKIPPT`. Unter Schwelle (Hysterese) erlischt alles sauber.
  4. **`invertRollRate`** (Sensorik-Setting) kehrt die Kipprichtung in **beiden** Ansichten konsistent um.
  5. **Readout:** flacher Balken weg; `ROLL n°` + Badge korrekt.
  6. **Custom-Modell** (falls geladen): Umkipp-Glow am Boden, Modell nicht eingefärbt.
  7. **Replay:** 2D/3D-Kippen folgt den abgespielten Paketen wie live.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-09-21-gmeter-3d-kippfunktion.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 21 G-meter + 3D Kippfunktion redesign plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §4.1 Roll aus Kippfunktion (Fallback) → Task 1. ✔
- §4.2 3D-Umkipp-Glow → Task 2. ✔
- §4.3 2D Horizont + Bank-Ring → Task 3. ✔
- §4.4 Readout statt Balken → Task 4. ✔
- §4.5 Datenfluss `renderGauges` → Task 1 Step 6. ✔
- §6 Tests (reine Helfer TDD; Backward-Compat-Fallback) → Task 1/2 Tests. ✔
- §8 Sequencing → Task-Reihenfolge identisch. ✔

**Placeholder-Scan:** Einziger „frisch ankern"-Hinweis ist die CSS-Cleanup-Stelle (Task 4 Step 3) — bewusst, da CRLF-Anker erst zur Edit-Zeit final; Inhalt (welche Selektoren weg, welche Regel neu) ist vollständig spezifiziert. Kein TODO/TBD.

**Typ-/Namens-Konsistenz:** `resolveRollRad(rollDeg,gx,gy,gz)`, `rolloverGlowAlpha(over,tMs)`, `_floor`, `_rolloverGlow`, IDs `rollVal`/`rollOver`, Klasse `roll-cap` — überall identisch verwendet. `update()` liest `imu.rollDeg`/`imu.over`; `renderGauges` sendet genau diese Keys. ✔

## Phase Map

| Phase | Inhalt | Status |
|-------|--------|--------|
| 19a/19b | Roll-Firmware + Rollwinkel-Dashboard (Kippfunktion-Basis) | done |
| 20 | Drift-System-Rework | done |
| (Settings-Redesign) | Auto-Save-Settings inkl. `invertRollRate` | done |
| **21** | **G-Meter + 3D-Modell Redesign mit Kippfunktion** | **dieser Plan** |
