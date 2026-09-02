# Phase 62 — Bewegungsschicht Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bewegung im Programm wird unterbrechbar, geschwindigkeits-bewusst und bildratenunabhängig — ohne neue Abhängigkeit und ohne sichtbare Layout-Änderung im Standbild.

**Architecture:** Ein pures Feder-Modul (`spring.js`, `node:test`-abgedeckt) liefert die Mathematik; ein dünner DOM-Treiber (`motion.js`) hält **eine** rAF-Schleife, die sich selbst startet und stoppt, und fasst nur `transform`/`opacity` an. Druck-Feedback, Tab-Wechsel und Dialoge werden darauf umgestellt; `gauges.js` verliert sein bildratenabhängiges LERP.

**Tech Stack:** Vanilla ESM (Konvention Phase 42), `node:test`, Vite-Bundle, Electron. Keine neue Laufzeit-Abhängigkeit.

**Spec:** `docs/superpowers/specs/2026-09-01-62-64-apple-politur-design.md`

## Global Constraints

- **Keine neue Runtime-Abhängigkeit.** `package.json` bleibt bei serialport, electron-updater, three.
- **Nur `transform` und `opacity` animieren.** Keine Layout-Eigenschaften, keine Canvas-Inhalte.
- **Dämpfung 1,0 als Standard.** Überschwingen ausschließlich nach einer Geste, die selbst Schwung erzeugt hat. **Zahlen niemals mit Überschwingen** — ein Messwert darf nie über dem echten Wert stehen.
- **Pure Logik als dependency-freies ESM-Objektmodul** mit `export default {...}` (Stil `geo.js`, `kart-stats.js`, `smoothing.js`), `node:test`-abgedeckt, wirft nie. **DOM-Verdrahtung wird nicht unit-getestet** — `node --check` plus statischer Grep plus manuelle Abnahme.
- **Dateien sind CRLF.** Vor jedem Edit die Zielstelle frisch lesen und den Anker aus diesem Read kopieren. Zur Verifikation das Grep-Tool benutzen, nicht Shell-Grep.
- **Zeilen-Gate:** neue Dateien bleiben unter 520 Inhaltszeilen, gemessen als `(Get-Content <f> | Measure-Object -Line).Lines`.
- **Baselines:** Phase 62 soll die Screenshot-Baselines **nicht** bewegen. Bewegen sie sich doch, ist das ein ungewollter Layout-Effekt und wird untersucht, nicht weggefroren.
- **Commits:** conventional + Body + die Trailer `Co-Authored-By` und `Claude-Session`. Keine Anführungszeichen in der Commit-Nachricht (PowerShell-Parsing). Niemals `.claude/` oder Plan-Docs mitcommitten außer im letzten Task.
- **Arbeitsverzeichnis:** `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`
- **Branch:** `feat/phase-62-bewegungsschicht`, aufgesetzt auf `main` (Stand `68ac64b`) nach Merge des Spec-Branches `docs/spec-62-64-apple-politur`.

## Ist-Zustand, der den Zuschnitt bestimmt

- Es existiert bereits eine **dauerhafte 60-fps-Schleife**: `animLoop()` in `src/live-ui.js:472`, gestartet in `src/app-init.js:231`. `motion.js` hängt sich **nicht** dort ein, sondern hält eine eigene Schleife, die nur läuft, solange Federn aktiv sind — sonst kostet Bewegung Strom, wenn sich nichts bewegt.
- Overlays werden an **zwölf verstreuten Stellen** per `classList.add('show')` geöffnet (`app-init.js:77/80`, `races.js:226`, `pit-wall.js:19`, …). Es gibt **keinen** zentralen Öffner. Task 5 fasst deshalb keine dieser Stellen an, sondern beobachtet die Klasse — ein Eingriff statt zwölf.
- `gauges.js:46` hält `const LERP = 0.18` und glättet damit pro Frame statt pro Zeit.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/spring.js` | pure Feder-Mathematik: Integrationsschritt, Momentum-Projektion, Rubber-Banding |
| Create | `test/spring.test.js` | `node:test`-Abdeckung des Moduls |
| Create | `src/motion.js` | DOM-Treiber: eine selbstverwaltende rAF-Schleife, `transform`/`opacity` |
| Modify | `src/styles/components.css` | `.btn:active` weicht dem `.is-pressed`-Zustand; `prefers-reduced-motion`-Block |
| Modify | `src/styles/base.css` | `.tab`-Keyframe entfällt (Task 4). **Keine** Druck-Regel: Nav-Einträge bekommen ihre Skalierung von `motion.js`, dafür ist kein CSS nötig. |
| Modify | `src/rasicross.js` | `setupTabs`: Federn statt Klassenwechsel; Druck-Delegation global verdrahten |
| Modify | `src/styles/modals.css` | `dialogIn`-Keyframe entfällt (Bewegung kommt aus `motion.js`) |
| Modify | `src/gauges.js` | `LERP` weicht der `dt`-basierten Feder |
| Create | `docs/superpowers/plans/2026-09-01-62-bewegungsschicht.md` | dieser Plan (letzter Task) |

Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 (sequenziell, je Task ein Commit).

---

### Task 1: Pures Feder-Modul

**Files:**
- Create: `src/spring.js`
- Test: `test/spring.test.js`

**Interfaces:**
- Consumes: nichts (dependency-frei).
- Produces: `export default { DAMPING, RESPONSE, DECEL, MAX_DT, springStep, project, rubberband }`
  - `springStep(value, velocity, target, dt, damping, response)` → `{ value, velocity, done }`. `dt` in **Sekunden**. `damping`/`response` optional.
  - `project(velocity, decel)` → Zahl (projizierte Zusatzstrecke, gleiche Einheit wie `velocity` pro Sekunde).
  - `rubberband(overshoot, dimension, constant)` → gedämpfter Überstand.

- [ ] **Step 1: Den Test zuerst schreiben**

Datei `test/spring.test.js` (Stil wie `test/smoothing.test.js`: ESM, `node:test`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../src/spring.js';

test('Modul exportiert die erwartete Oberflaeche', () => {
  assert.equal(typeof S.springStep, 'function');
  assert.equal(typeof S.project, 'function');
  assert.equal(typeof S.rubberband, 'function');
  assert.equal(S.DAMPING, 1);
  assert.ok(S.RESPONSE > 0 && S.RESPONSE < 1);
});

test('springStep konvergiert gegen das Ziel', () => {
  let v = 0, vel = 0, done = false;
  for (let i = 0; i < 400 && !done; i++) {
    const r = S.springStep(v, vel, 100, 1 / 60);
    v = r.value; vel = r.velocity; done = r.done;
  }
  assert.ok(done, 'Feder muss zur Ruhe kommen');
  assert.equal(v, 100, 'am Ende exakt auf dem Ziel');
});

test('kritisch gedaempft schwingt nicht ueber', () => {
  let v = 0, vel = 0;
  for (let i = 0; i < 400; i++) {
    const r = S.springStep(v, vel, 100, 1 / 60);
    v = r.value; vel = r.velocity;
    assert.ok(v <= 100 + 1e-9, 'Wert darf das Ziel nie ueberschreiten, war ' + v);
    if (r.done) break;
  }
});

test('mitgegebener Schwung veraendert das Ergebnis (Unterbrechbarkeit)', () => {
  // Der Kern: derselbe Ist-Wert und dasselbe Ziel, aber unterschiedliche
  // Geschwindigkeit muessen zu unterschiedlichen Ergebnissen fuehren.
  // Eine Feder, die den Schwung ignoriert, wuerde hier gleich antworten
  // -- und genau daran scheitert jede CSS-Transition.
  const ruhend = S.springStep(50, 0, 100, 1 / 60);
  const schwung = S.springStep(50, 300, 100, 1 / 60);
  assert.notEqual(ruhend.value, schwung.value);
  assert.ok(schwung.value > ruhend.value, 'Schwung traegt weiter');
  // Gegenrichtung: negativer Schwung bremst den Weg zum Ziel.
  const gegen = S.springStep(50, -300, 100, 1 / 60);
  assert.ok(gegen.value < ruhend.value, 'Gegenschwung haelt zurueck');
});

test('springStep haelt einen absurden dt aus', () => {
  const r = S.springStep(0, 0, 100, 5);
  assert.ok(Number.isFinite(r.value), 'kein NaN/Infinity bei grossem dt');
  assert.ok(Math.abs(r.value) <= 100);
});

test('springStep laesst den Zustand bei ungueltigen Eingaben unveraendert', () => {
  for (const bad of [NaN, 0, -1, null, undefined]) {
    const r = S.springStep(5, 2, 100, bad);
    assert.equal(r.value, 5);
    assert.equal(r.velocity, 2);
    assert.equal(r.done, false);
  }
});

test('project folgt der Exponential-Formel', () => {
  const d = 0.998;
  assert.ok(Math.abs(S.project(1000, d) - (1000 / 1000) * d / (1 - d)) < 1e-9);
  assert.equal(S.project(0, d), 0);
  assert.equal(S.project(NaN, d), 0);
});

test('rubberband daempft und waechst monoton', () => {
  const a = S.rubberband(50, 400);
  const b = S.rubberband(200, 400);
  assert.ok(a < 50, 'gedaempft: weniger als der rohe Ueberstand');
  assert.ok(b > a, 'mehr Ueberstand ergibt mehr Weg');
  assert.equal(S.rubberband(0, 400), 0);
  assert.equal(S.rubberband(-50, 400), -S.rubberband(50, 400));
});
```

- [ ] **Step 2: Test laufen lassen, Rot bestätigen**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/spring.js'`.

- [ ] **Step 3: Modul schreiben**

Datei `src/spring.js`:

```js
// ============================================================
//  RasiCross — spring.js  (Feder-Mathematik, Phase 62)
// ============================================================
//  Dependency-freies ESM-Objektmodul (Konvention Phase 42, wie
//  kart-stats.js): laeuft unter node:test (CI) und im Browser.
//  Kein DOM, kein State, wirft nie.
//
//  Zweck: Bewegung soll unterbrechbar sein. Eine Feder kennt nur
//  Ist-Wert, Geschwindigkeit und Ziel -- ein neues Ziel mitten im
//  Flug aendert nichts am Zustand, die Bewegung laeuft einfach
//  weiter. Genau das kann eine CSS-Transition nicht.
//
//  Parameter wie bei Apple, nicht wie im Physikbuch: DAMPING ist das
//  Daempfungsverhaeltnis (1 = kritisch gedaempft, kein Ueberschwingen),
//  RESPONSE die Zeit in Sekunden, in der das Ziel praktisch erreicht
//  ist. Masse/Steifigkeit tauchen nach aussen nicht auf.
// ============================================================

  // Standard: kritisch gedaempft. Ueberschwingen (< 1) nur dort, wo der
  // Nutzer selbst Schwung erzeugt hat -- nach einer Wisch- oder Zieh-Geste.
  const DAMPING = 1;
  const RESPONSE = 0.35;
  // Scroll-Verzoegerung wie in Apples Beispielcode (Designing Fluid
  // Interfaces). NICHT die Lehrbuchformel v^2/(2a).
  const DECEL = 0.998;
  // Groessere Zeitschritte werden gekappt: nach einem Tab-Wechsel oder
  // einem haengenden Frame kaeme sonst ein Sprung statt einer Bewegung.
  // 1/30 s, nicht mehr: bei 0.064 springt der erste Schritt aus der Ruhe
  // auf 132 % des Ziels (nachgerechnet) -- das waere genau das
  // Ueberschwingen, das hier ausgeschlossen sein soll.
  const MAX_DT = 1 / 30;
  // Unterhalb davon gilt die Feder als angekommen und rastet exakt ein.
  const EPS = 0.01;

  function springStep(value, velocity, target, dt, damping, response) {
    let v = Number(value), vel = Number(velocity), t = Number(target);
    if (!isFinite(v)) v = 0;
    if (!isFinite(vel)) vel = 0;
    if (!isFinite(t)) t = v;
    let step = Number(dt);
    if (!isFinite(step) || step <= 0) return { value: v, velocity: vel, done: false };
    if (step > MAX_DT) step = MAX_DT;
    let z = Number(damping);
    if (!isFinite(z) || z <= 0) z = DAMPING;
    let r = Number(response);
    if (!isFinite(r) || r <= 0) r = RESPONSE;
    // Halbimplizites Euler-Verfahren: erst die Geschwindigkeit aus der
    // aktuellen Auslenkung, dann die Position aus der neuen Geschwindigkeit.
    // Stabiler als explizites Euler bei den hier ueblichen Schrittweiten.
    const omega = (2 * Math.PI) / r;
    const accel = -(omega * omega) * (v - t) - (2 * z * omega) * vel;
    vel += accel * step;
    v += vel * step;
    if (Math.abs(t - v) < EPS && Math.abs(vel) < EPS) {
      return { value: t, velocity: 0, done: true };
    }
    return { value: v, velocity: vel, done: false };
  }

  // Wohin traegt der Schwung? Fuer Wurf-Gesten: erst den Ruhepunkt
  // projizieren, dann den naechstgelegenen Rastpunkt dazu waehlen --
  // nicht den, der beim Loslassen am naechsten war.
  function project(velocity, decel) {
    const v = Number(velocity);
    if (!isFinite(v) || v === 0) return 0;
    let d = Number(decel);
    if (!isFinite(d) || d <= 0 || d >= 1) d = DECEL;
    return (v / 1000) * d / (1 - d);
  }

  // Weicher Rand statt harter Anschlag: je weiter darueber hinaus, desto
  // weniger folgt das Element. Ein harter Stopp liest sich als eingefroren.
  function rubberband(overshoot, dimension, constant) {
    const o = Number(overshoot), dim = Number(dimension);
    if (!isFinite(o) || o === 0 || !isFinite(dim) || dim <= 0) return 0;
    let c = Number(constant);
    if (!isFinite(c) || c <= 0) c = 0.55;
    return (o * dim * c) / (dim + c * Math.abs(o));
  }

  export default { DAMPING, RESPONSE, DECEL, MAX_DT, springStep, project, rubberband };
```

- [ ] **Step 4: Test laufen lassen, Grün bestätigen**

Run: `npm test`
Expected: PASS, Gesamtzahl steigt von 229 auf 237.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 Meldungen.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/spring.js test/spring.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(motion): pures Feder-Modul mit Projektion und Rubber-Banding (Phase 62)

Eine Feder kennt nur Ist-Wert, Geschwindigkeit und Ziel -- ein neues Ziel mitten im Flug laesst die Bewegung weiterlaufen, statt sie neu zu starten. Genau das kann eine CSS-Transition nicht, und genau darauf baut die restliche Phase auf. Parameter sind Daempfung und Response statt Masse und Steifigkeit; dt wird gekappt, damit ein haengender Frame keinen Sprung erzeugt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

---

### Task 2: DOM-Treiber mit selbstverwalteter Schleife

**Files:**
- Create: `src/motion.js`

**Interfaces:**
- Consumes: `src/spring.js` (`springStep`).
- Produces: `export default { animate, set, stop, isReduced, prefersReduced }`
  - `animate(el, prop, target, opts)` — `prop` ist `'x' | 'y' | 'scale' | 'opacity'`; `opts` = `{ damping, response, velocity, onDone }`. Mehrfachaufruf auf derselben Eigenschaft **ersetzt das Ziel und behält Wert und Geschwindigkeit**.
  - `set(el, prop, value)` — sofort setzen, laufende Feder derselben Eigenschaft verwerfen.
  - `stop(el)` — alle Federn des Elements beenden.
  - `reset(el)` — Federn beenden, Tracking loeschen und `style.transform`/`style.opacity` leeren. **Notwendig**, weil ein stehengebliebener Inline-`transform` den CSS-Hover-Lift (`.btn:hover{transform:translateY(-1px)}`) dauerhaft ueberschreiben wuerde.
  - `isReduced()` — `true`, wenn `prefers-reduced-motion: reduce` gilt.

- [ ] **Step 1: Modul schreiben**

Datei `src/motion.js`:

```js
// ============================================================
//  RasiCross — motion.js  (DOM-Treiber fuer Federn, Phase 62)
// ============================================================
//  KEIN pures Modul und bewusst nicht unit-getestet: DOM-Verdrahtung
//  wird im Projekt per node --check, statischem Grep und manueller
//  Abnahme geprueft (Hausregel seit Phase 42). Die Mathematik liegt
//  in spring.js und ist dort abgedeckt.
//
//  Eine einzige rAF-Schleife fuer alle laufenden Federn. Sie startet,
//  wenn die erste Feder gesetzt wird, und stoppt, sobald keine mehr
//  laeuft -- live-ui.js haelt bereits einen Dauerloop, ein zweiter
//  darf nicht im Leerlauf mitlaufen.
//
//  Angefasst werden ausschliesslich transform und opacity: nur die
//  gehen ohne Layout durch den Compositor.
// ============================================================
import RasiSpring from './spring.js';

// Pro Element ein Eintrag: die aktiven Eigenschaften mit Wert und
// Geschwindigkeit. WeakMap, damit entfernte Knoten nicht festgehalten werden.
const _tracks = new WeakMap();
// Zusaetzlich eine flache Liste der aktiven Elemente -- ueber eine WeakMap
// kann man nicht iterieren.
let _active = [];
let _raf = 0;
let _last = 0;

const DEFAULTS = { x: 0, y: 0, scale: 1, opacity: 1 };

function prefersReduced() {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function isReduced() { return prefersReduced(); }

function _track(el) {
  let t = _tracks.get(el);
  if (!t) { t = { props: {}, el }; _tracks.set(el, t); _active.push(el); }
  else if (_active.indexOf(el) < 0) { _active.push(el); }
  return t;
}

function _paint(el, props) {
  const x = props.x ? props.x.value : DEFAULTS.x;
  const y = props.y ? props.y.value : DEFAULTS.y;
  const s = props.scale ? props.scale.value : DEFAULTS.scale;
  // Eine einzige transform-Zeichenkette: getrennte Zuweisungen wuerden
  // sich gegenseitig ueberschreiben.
  el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(' + s + ')';
  if (props.opacity) el.style.opacity = String(props.opacity.value);
}

function _tick(now) {
  const dt = _last ? (now - _last) / 1000 : 1 / 60;
  _last = now;
  const still = [];
  for (const el of _active) {
    const t = _tracks.get(el);
    if (!t || !el.isConnected) continue;
    let running = false;
    for (const name of Object.keys(t.props)) {
      const p = t.props[name];
      if (p.done) continue;
      const r = RasiSpring.springStep(p.value, p.velocity, p.target, dt,
        p.damping, p.response);
      p.value = r.value; p.velocity = r.velocity; p.done = r.done;
      if (!r.done) running = true;
      else if (p.onDone) { const f = p.onDone; p.onDone = null; f(el); }
    }
    _paint(el, t.props);
    if (running) still.push(el);
  }
  _active = still;
  if (_active.length) _raf = requestAnimationFrame(_tick);
  else { _raf = 0; _last = 0; }
}

function _start() {
  if (_raf) return;
  _last = 0;
  _raf = requestAnimationFrame(_tick);
}

function animate(el, prop, target, opts) {
  if (!el || !(prop in DEFAULTS)) return;
  const o = opts || {};
  const t = _track(el);
  const p = t.props[prop] || (t.props[prop] = {
    value: DEFAULTS[prop], velocity: 0, target: DEFAULTS[prop], done: true,
  });
  // Reduzierte Bewegung: Ziel sofort setzen, keine Feder. Der Zustand
  // bleibt konsistent, damit spaetere Aufrufe nicht springen.
  if (prefersReduced()) {
    p.value = target; p.velocity = 0; p.target = target; p.done = true;
    _paint(el, t.props);
    if (o.onDone) o.onDone(el);
    return;
  }
  // Der Kern der Unterbrechbarkeit: value und velocity bleiben stehen,
  // nur das Ziel wechselt.
  p.target = Number(target);
  p.damping = o.damping;
  p.response = o.response;
  if (o.velocity != null) p.velocity = Number(o.velocity) || 0;
  p.onDone = o.onDone || null;
  p.done = false;
  _start();
}

function set(el, prop, value) {
  if (!el || !(prop in DEFAULTS)) return;
  const t = _track(el);
  t.props[prop] = { value: Number(value), velocity: 0, target: Number(value), done: true };
  _paint(el, t.props);
}

function stop(el) {
  const t = el && _tracks.get(el);
  if (!t) return;
  for (const name of Object.keys(t.props)) t.props[name].done = true;
}

// Ohne das bliebe nach der ersten Beruehrung ein Inline-transform stehen --
// und der wuerde .btn:hover{transform:translateY(-1px)} dauerhaft
// ueberschreiben. Der Hover-Lift waere ab dem ersten Klick tot.
function reset(el) {
  if (!el) return;
  stop(el);
  _tracks.delete(el);
  el.style.transform = '';
  el.style.opacity = '';
}

export default { animate, set, stop, reset, isReduced, prefersReduced };
```

- [ ] **Step 2: Syntax prüfen**

Run: `node --check src/motion.js`
Expected: keine Ausgabe.

- [ ] **Step 3: Statisch verifizieren, dass keine Layout-Eigenschaft angefasst wird**

Mit dem Grep-Tool in `src/motion.js` nach `style\.(width|height|top|left|margin|padding)` suchen.
Expected: 0 Treffer. Erlaubt sind nur `style.transform` und `style.opacity`.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 Meldungen.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/motion.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(motion): DOM-Treiber mit einer selbstverwalteten rAF-Schleife (Phase 62)

Die Schleife startet mit der ersten Feder und stoppt, sobald keine mehr laeuft - live-ui.js haelt bereits einen Dauerloop, ein zweiter darf nicht im Leerlauf mitlaufen. Ein neues Ziel laesst Wert und Geschwindigkeit stehen, damit Bewegung mitten im Flug umgelenkt werden kann. Angefasst werden nur transform und opacity; bei prefers-reduced-motion wird das Ziel sofort gesetzt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

---

### Task 3: Druck-Feedback auf `pointerdown`

**Files:**
- Modify: `src/styles/components.css` (Anker: `.btn:active:not(:disabled){transform:translateY(0)}`)
- Modify: `src/rasicross.js` (neue Funktion + Aufruf in `setupTabs`-Nähe)

**Interfaces:**
- Consumes: `motion.js` (`animate`).
- Produces: `setupPressFeedback()` — global delegierter Handler; setzt zusätzlich `_lastPressEl` für Task 5. Export: `export { setupPressFeedback, lastPressEl }` mit `lastPressEl()` als Accessor (ESM-Importe von `let` sind Momentaufnahmen — dasselbe Muster wie `kart3dIsReady`).

- [ ] **Step 1: CSS-Anker ersetzen**

In `src/styles/components.css` die Zeile

```css
.btn:active:not(:disabled){transform:translateY(0)}
```

ersetzen durch:

```css
/* Phase 62: Druck quittiert auf pointerdown, nicht erst beim Loslassen.
   Die Skalierung faehrt motion.js; hier bleibt nur, was CSS besser kann. */
.btn.is-pressed:not(:disabled){box-shadow:none;transform:none}
```

- [ ] **Step 2: Delegierten Handler in `src/rasicross.js` ergänzen**

Direkt **vor** `function setupTabs() {` einfügen:

```js
// ============================================================
// DRUCK-FEEDBACK (Phase 62)
// ============================================================
// Apple: Feedback gehoert auf den Druck, nicht auf das Loslassen --
// sobald es am Loslassen haengt, faellt das Gefuehl von Direktheit ab.
// Ein delegierter Handler statt Bindungen pro Element: die Oberflaeche
// baut Karten, Chips und Zeilen zur Laufzeit nach.
const PRESS_SEL = '.btn,.nav-item,.kart-chip,.card.clickable,tr.clickable';
let _lastPressEl = null;
function lastPressEl() { return _lastPressEl; }
function setupPressFeedback() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target && e.target.closest && e.target.closest(PRESS_SEL);
    if (!el || el.disabled) return;
    _lastPressEl = el;
    el.classList.add('is-pressed');
    RasiMotion.animate(el, 'scale', 0.97, { response: 0.12 });
  }, { passive: true });
  // pointerup faengt den Normalfall, pointercancel das Wegziehen --
  // ohne beides bliebe ein Element gedrueckt stehen.
  const release = (e) => {
    const el = e.target && e.target.closest && e.target.closest(PRESS_SEL);
    if (!el) return;
    el.classList.remove('is-pressed');
    // reset() im onDone: sonst bleibt ein Inline-transform stehen und der
    // Hover-Lift aus dem CSS waere ab dem ersten Klick ueberschrieben.
    RasiMotion.animate(el, 'scale', 1, {
      response: 0.25, onDone: (n) => RasiMotion.reset(n),
    });
  };
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
}
```

- [ ] **Step 3: Import und Aufruf ergänzen**

In `src/rasicross.js` den Import `import RasiMotion from './motion.js';` zu den bestehenden Imports am Dateikopf hinzufügen (alphabetisch bei den übrigen `Rasi*`-Importen einsortieren), und in derselben Funktion, in der `setupTabs()` aufgerufen wird, direkt danach `setupPressFeedback();` ergänzen. Den Export ergänzen: `lastPressEl` und `setupPressFeedback` in die bestehende `export { … }`-Liste aufnehmen.

- [ ] **Step 4: Reduzierte Bewegung im CSS absichern**

Ans Ende von `src/styles/components.css` anhängen:

```css
/* Phase 62: Reduzierte Bewegung -- die Federn in motion.js setzen ihr
   Ziel dann sofort; hier fallen zusaetzlich die CSS-Uebergaenge weg. */
@media (prefers-reduced-motion: reduce){
  .btn,.nav-item{transition:none}
}
```

- [ ] **Step 5: Verifizieren**

Run: `node --check src/rasicross.js`
Run: `npm run lint` → 0
Run: `npm run lint:css` → OK
Mit dem Grep-Tool prüfen, dass `:active` in `src/styles/` nur noch dort steht, wo es nicht um Druck-Feedback geht.

- [ ] **Step 6: Funktionstests laufen lassen (Regressionsgefahr)**

Run: `npx vite build && npx playwright test e2e/app.spec.js e2e/karts.spec.js`
Expected: alle grün. **Diese Tests klicken Buttons — wenn `pointerdown` etwas bricht, fällt es hier auf.**

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/styles/components.css src/rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(motion): Druck quittiert auf pointerdown statt beim Loslassen (Phase 62)

Im gesamten CSS gab es genau eine :active-Regel - gedrueckte Elemente sahen bisher praktisch gleich aus wie ungedrueckte. Ein delegierter Handler deckt Buttons, Nav-Eintraege, Kart-Chips und klickbare Karten und Zeilen ab, auch die zur Laufzeit erzeugten. pointercancel faengt das Wegziehen, sonst bliebe ein Element gedrueckt stehen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

---

### Task 4: Tab-Wechsel auf Federn

**Files:**
- Modify: `src/styles/base.css` (Anker: `.tab{display:none;animation:fadeUp .35s ease forwards}` und der `@keyframes fadeUp`-Block)
- Modify: `src/rasicross.js` (Anker: in `setupTabs`, die Zeile `if (panel) panel.classList.add('active');`)

**Interfaces:**
- Consumes: `motion.js` (`animate`, `set`).
- Produces: nichts Neues.

- [ ] **Step 1: CSS-Anker ersetzen**

In `src/styles/base.css` die Zeile

```css
.tab{display:none;animation:fadeUp .35s ease forwards}
```

ersetzen durch:

```css
/* Phase 62: die feste Keyframe-Animation ist weg -- sie liess sich
   beim schnellen Umschalten nicht greifen. Bewegung kommt aus motion.js. */
.tab{display:none}
```

Den kompletten `@keyframes fadeUp{…}`-Block darunter löschen — nach dem Ersetzen hat er keinen Verwender mehr.

- [ ] **Step 2: Federung in `setupTabs` ergänzen**

Die Zeile

```js
      if (panel) panel.classList.add('active');
```

ersetzen durch:

```js
      if (panel) {
        panel.classList.add('active');
        // Aus 8px Versatz und leichter Transparenz hereinfedern. Wichtig:
        // set() vor animate(), damit der Startwert definiert ist -- sonst
        // federt der zweite Wechsel aus dem Endzustand des ersten.
        RasiMotion.set(panel, 'y', 8);
        RasiMotion.set(panel, 'opacity', 0);
        RasiMotion.animate(panel, 'y', 0, { response: 0.3 });
        RasiMotion.animate(panel, 'opacity', 1, { response: 0.25 });
      }
```

- [ ] **Step 3: Verifizieren**

Run: `node --check src/rasicross.js`
Mit dem Grep-Tool nach `fadeUp` über `src/` suchen → **0 Treffer**.
Run: `npm run lint` → 0; `npm run lint:css` → OK

- [ ] **Step 4: Tab-Tests laufen lassen**

Run: `npx vite build && npx playwright test e2e/app.spec.js`
Expected: grün — insbesondere „alle Tabs rendern".

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/styles/base.css src/rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(motion): Tab-Wechsel federt statt fester Keyframe-Animation (Phase 62)

fadeUp lief 350 ms mit fester Dauer und liess sich nicht greifen - wer schnell zwischen zwei Seiten wechselte, sah es haken. Die Feder startet beim Umschalten vom aktuellen Wert weiter, statt neu anzusetzen. Der Keyframe-Block ist ersatzlos entfallen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

---

### Task 5: Dialoge wachsen aus dem Auslöser

**Files:**
- Modify: `src/styles/modals.css` (Anker: `animation:dialogIn .3s cubic-bezier(.34,1.56,.64,1);` und der `@keyframes dialogIn`-Block)
- Modify: `src/motion.js` (neue Funktion `watchOverlays`)
- Modify: `src/rasicross.js` (Aufruf ergänzen)

**Warum kein Umbau der Aufrufstellen:** Overlays werden an zwölf verstreuten Stellen per `classList.add('show')` geöffnet (`app-init.js:77`, `app-init.js:80`, `races.js:226`, `pit-wall.js:19`, …), es gibt keinen zentralen Öffner. Ein `MutationObserver` auf der Klasse deckt alle zwölf mit einem Eingriff ab — und neue Aufrufstellen automatisch mit.

**Interfaces:**
- Consumes: `spring.js`, `rasicross.js` (`lastPressEl` aus Task 3).
- Produces: `watchOverlays(getTrigger)` — `getTrigger` ist eine Funktion, die das zuletzt gedrückte Element liefert. Ergänzt den Default-Export von `motion.js`.

- [ ] **Step 1: CSS-Anker ersetzen**

In `src/styles/modals.css` die Zeile

```css
  animation:dialogIn .3s cubic-bezier(.34,1.56,.64,1);
```

ersatzlos löschen und den kompletten `@keyframes dialogIn{…}`-Block darunter ebenfalls löschen.

- [ ] **Step 2: `watchOverlays` in `src/motion.js` ergänzen**

Vor der `export default`-Zeile einfügen:

```js
// Overlays werden an zwoelf verstreuten Stellen per classList.add('show')
// geoeffnet -- es gibt keinen zentralen Oeffner. Ein Beobachter auf der
// Klasse deckt alle ab, statt zwoelf Aufrufstellen umzubauen.
function watchOverlays(getTrigger) {
  if (typeof MutationObserver !== 'function') return;
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const ov = rec.target;
      if (!ov.classList || !ov.classList.contains('overlay')) continue;
      if (!ov.classList.contains('show')) continue;
      const dlg = ov.querySelector('.dialog');
      if (!dlg) continue;
      // Apple: die Flaeche soll dort entstehen, wo sie ausgeloest wurde.
      // Ohne Ursprung skaliert sie aus der Bildmitte und der raeumliche
      // Zusammenhang zum Knopf geht verloren.
      const trig = typeof getTrigger === 'function' ? getTrigger() : null;
      if (trig && trig.getBoundingClientRect && dlg.getBoundingClientRect) {
        const t = trig.getBoundingClientRect();
        const d = dlg.getBoundingClientRect();
        if (d.width > 0 && d.height > 0) {
          const ox = ((t.left + t.width / 2) - d.left) / d.width * 100;
          const oy = ((t.top + t.height / 2) - d.top) / d.height * 100;
          dlg.style.transformOrigin = ox + '% ' + oy + '%';
        }
      } else {
        dlg.style.transformOrigin = '50% 50%';
      }
      set(dlg, 'scale', 0.92);
      set(dlg, 'opacity', 0);
      animate(dlg, 'scale', 1, { response: 0.3 });
      animate(dlg, 'opacity', 1, { response: 0.22 });
    }
  });
  obs.observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['class'],
  });
}
```

Und die Export-Zeile ersetzen durch:

```js
export default { animate, set, stop, reset, isReduced, prefersReduced, watchOverlays };
```

- [ ] **Step 3: Aufruf in `src/rasicross.js` ergänzen**

Direkt nach `setupPressFeedback();` (Task 3) ergänzen:

```js
  RasiMotion.watchOverlays(lastPressEl);
```

- [ ] **Step 4: Verifizieren**

Run: `node --check src/motion.js && node --check src/rasicross.js`
Mit dem Grep-Tool nach `dialogIn` über `src/` suchen → **0 Treffer**.
Run: `npm run lint` → 0; `npm run lint:css` → OK

- [ ] **Step 5: Dialog-Tests laufen lassen**

Run: `npx vite build && npx playwright test e2e/karts.spec.js`
Expected: grün — der Test „⚙-Button oeffnet Kart-Fenster" und die Dialog-Pfade laufen hier durch.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/styles/modals.css src/motion.js src/rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(motion): Dialoge wachsen aus dem ausloesenden Element (Phase 62)

dialogIn skalierte mit fester Dauer aus der Bildmitte - der raeumliche Zusammenhang zum gedrueckten Knopf fehlte. Statt zwoelf verstreute Aufrufstellen umzubauen, beobachtet ein MutationObserver die show-Klasse und setzt den transform-origin auf den zuletzt gedrueckten Ausloeser. Neue Aufrufstellen sind damit automatisch abgedeckt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

---

### Task 6: `gauges.js` von LERP auf die Feder

**Files:**
- Modify: `src/gauges.js` (Anker: `const LERP = 0.18;` und `function lerp(a, b) { return a + (b - a) * LERP; }`, Verwender in `renderGauges` ab `k.display.gxLerp = lerp(…)`, sowie die Marker-Zeile `void [renderDriftBadge, renderRollBar, lerp, renderGauges, drawGMeter];` und die Export-Zeile darunter)

**Interfaces:**
- Consumes: `spring.js` (`springStep`).
- Produces: `renderGauges()` bleibt namens- und signaturgleich. `lerp` entfällt aus Marker und Export.

- [ ] **Step 1: LERP durch die Feder ersetzen**

Die beiden Zeilen

```js
const LERP = 0.18;
function lerp(a, b) { return a + (b - a) * LERP; }
```

ersetzen durch:

```js
// Phase 62: LERP 0.18 war bildratenabhaengig -- bei 30 fps glaettete es
// anders als bei 60. Dieselbe Feder wie im Rest der Oberflaeche, nur
// ueber dt statt pro Frame. Daempfung 1: G-Werte duerfen nicht
// ueberschwingen, sonst zeigt der Zeiger mehr an, als anlag.
const G_RESPONSE = 0.18;
let _gaugeLastTick = 0;
const _gVel = { gx: 0, gy: 0 };
function gaugeDt(now) {
  const dt = _gaugeLastTick ? (now - _gaugeLastTick) / 1000 : 1 / 60;
  _gaugeLastTick = now;
  return dt;
}
```

- [ ] **Step 2: Die Verwender in `renderGauges` umstellen**

Die beiden Zeilen

```js
  k.display.gxLerp = lerp(k.display.gxLerp, t.gx);
  k.display.gyLerp = lerp(k.display.gyLerp, t.gy);
```

ersetzen durch:

```js
  const _dt = gaugeDt(performance.now());
  const _rx = RasiSpring.springStep(k.display.gxLerp, _gVel.gx, t.gx, _dt, 1, G_RESPONSE);
  k.display.gxLerp = _rx.value; _gVel.gx = _rx.velocity;
  const _ry = RasiSpring.springStep(k.display.gyLerp, _gVel.gy, t.gy, _dt, 1, G_RESPONSE);
  k.display.gyLerp = _ry.value; _gVel.gy = _ry.velocity;
```

- [ ] **Step 3: Import ergänzen**

Nach `import RasiKart3D from './karts3d.js';` einfügen:

```js
import RasiSpring from './spring.js';
```

- [ ] **Step 4: Marker und Export bereinigen**

`lerp` aus der Marker-Zeile `void [renderDriftBadge, renderRollBar, lerp, renderGauges, drawGMeter];` und aus der `export { … }`-Zeile darunter entfernen. Beide Zeilen behalten die übrigen Einträge unverändert.

- [ ] **Step 5: Verifizieren**

Run: `node --check src/gauges.js`
Mit dem Grep-Tool nach `\blerp\b` über `src/gauges.js` suchen → nur noch `gxLerp`/`gyLerp` als Feldnamen, keine Funktion `lerp` mehr.
Mit dem Grep-Tool nach `lerp` über `src/` suchen → sicherstellen, dass kein anderes Modul die entfernte Funktion importiert hat.
Run: `npm test` → 237; `npm run lint` → 0

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/gauges.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
refactor(gauges): G-Glaettung ueber die dt-basierte Feder statt festem LERP (Phase 62)

LERP 0.18 lief pro Frame, nicht pro Zeit - bei 30 fps glaettete es doppelt so traege wie bei 60. Dieselbe Feder wie im Rest der Oberflaeche, mit Daempfung 1, damit der Zeiger nie mehr anzeigt als anlag. Die tote Hilfsfunktion faellt aus Marker und Export.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

---

### Task 7: Abschluss — volle Gates, Baseline-Kontrolle, Plan-Doc

**Files:**
- Create: `docs/superpowers/plans/2026-09-01-62-bewegungsschicht.md` (dieser Plan)

- [ ] **Step 1: Volle lokale Gates**

```bash
npm test                    # erwartet 237
npm run lint                # 0
npm run lint:css            # OK
node --check src/geo.js && node --check src/replay.js && node --check main.js && node --check preload.js && node --check tiles.js
python -m unittest discover -s test -p "test_*.py"   # 64 OK, unberuehrt
```
`__pycache__` danach löschen.

- [ ] **Step 2: Lokale e2e vollständig**

Run: `npx vite build && npx playwright test e2e/demo.spec.js e2e/karts.spec.js e2e/app.spec.js e2e/replay.spec.js`
Expected: 12/12 grün.

- [ ] **Step 3: Branch pushen und CI abwarten**

Der entscheidende Punkt dieser Phase: **die Screenshot-Suite muss grün bleiben.** Bewegung ist im Standbild unsichtbar; wenn `smoke` rot wird, ist ein ungewollter Layout-Effekt entstanden.

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push -u origin feat/phase-62-bewegungsschicht
gh run list --branch feat/phase-62-bewegungsschicht --limit 1
gh run watch <ID> --exit-status
```

- [ ] **Step 4: Bei rotem `smoke` — untersuchen, nicht einfrieren**

Artefakt `playwright-results` herunterladen, die Diff-Bilder ansehen und die Ursache benennen. Typische Kandidaten: die `transform`-Zeichenkette von `motion.js` erzeugt auf einem Panel einen Subpixel-Versatz, oder ein Panel behält `opacity` < 1, weil `set()` ohne folgendes `animate()` lief. **Ursache beheben, nicht die Baseline anpassen.**

- [ ] **Step 5: `graphify update .`** (nicht committen)

- [ ] **Step 6: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-09-01-62-bewegungsschicht.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
docs(phase-62): Plan Bewegungsschicht

Haelt fest, warum motion.js eine eigene Schleife bekommt statt sich in den Dauerloop von live-ui.js zu haengen, und warum die Dialoge ueber einen Beobachter laufen statt ueber zwoelf umgebaute Aufrufstellen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BqRgDJmXHT6obvFD4pjkFr
EOF
```

## Manuelle Abnahme (Nutzer, nicht automatisierbar)

- [ ] Buttons quittieren spürbar beim Drücken, nicht erst beim Loslassen.
- [ ] Schnelles Hin- und Herschalten zwischen zwei Tabs hakt nicht mehr.
- [ ] Dialoge wachsen sichtbar aus dem Knopf, den man gedrückt hat.
- [ ] G-Meter und 3D-Kart laufen unverändert flüssig, ohne Nachzieheffekt.
- [ ] Mit aktivierter Systemeinstellung „Bewegung reduzieren": keine Federn, alles springt sofort, nichts wirkt kaputt.

## Self-Review

- **Spec-Abdeckung:** `spring.js` → Task 1; `motion.js` mit einer Schleife → Task 2; Druck-Feedback auf `pointerdown` → Task 3; Tab-Wechsel → Task 4; Dialoge aus dem Auslöser → Task 5; `gauges.js` ohne LERP → Task 6; `prefers-reduced-motion` → Task 2 (JS) und Task 3 (CSS). Momentum-Projektion und Rubber-Banding sind in Task 1 gebaut und getestet, haben in Phase 62 aber **noch keinen Verwender** — sie werden erst gebraucht, wenn eine Zieh-Geste dazukommt. Bewusst so: die Mathematik gehört ins Modul, nicht in eine spätere Eilaktion.
- **Platzhalter:** keine. Jeder Schritt nennt Datei, Anker und vollständigen Code.
- **Typ-Konsistenz:** `springStep(value, velocity, target, dt, damping, response)` wird in Task 2 und Task 6 mit genau dieser Signatur aufgerufen. `animate(el, prop, target, opts)` in Task 3, 4 und 5 identisch. `lastPressEl` wird in Task 3 exportiert und in Task 5 übergeben.
- **Nicht angefasst:** `smoothing.js` bleibt, wie es ist — es glättet Messwerte für Maxima, nicht Bewegung. Zwei Module mit verwandter Mathematik und klar getrennter Aufgabe.

## Phase Map

- **Phase 62 → Bewegung** (dieser Plan)
- Phase 63 → Material & Tiefe: Material-Tokens, durchscheinende Sidebar, Scroll-Edge, `outdoor`/`reduced-transparency`/`contrast`
- Phase 64 → Typografie: Schriften mitliefern, Tracking-/Leading-Tokens, Gewichtshierarchie, Gate-Erweiterung
