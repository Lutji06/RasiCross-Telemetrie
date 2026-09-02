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
  const fired = [];
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
      else if (p.onDone) { fired.push([p.onDone, el]); p.onDone = null; }
    }
    // Erst malen, dann die Rueckrufe. Umgekehrt wuerde ein onDone, das
    // reset() aufruft, sofort wieder uebermalt -- der Inline-transform
    // bliebe stehen und der CSS-Hover waere tot.
    _paint(el, t.props);
    if (running) still.push(el);
  }
  _active = still;
  // _raf VOR den Rueckrufen nullen: ruft ein onDone seinerseits animate(),
  // muss _start() eine neue Schleife anwerfen duerfen.
  _raf = 0;
  for (const [fn, el] of fired) fn(el);
  if (_raf) return;
  if (_active.length) _raf = requestAnimationFrame(_tick);
  else _last = 0;
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
  // Federparameter ueberdauern ein Re-Target wie Wert und Geschwindigkeit --
  // nur bei ausdruecklicher Angabe wechseln, sonst wuerde ein Re-Target ohne
  // opts sie still auf undefined zuruecksetzen.
  if (o.damping != null) p.damping = o.damping;
  if (o.response != null) p.response = o.response;
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
      // Nur der Uebergang nach sichtbar zaehlt. Ohne das wuerde jede
      // andere Klassenaenderung am offenen Overlay den Dialog erneut
      // aus dem Nichts wachsen lassen.
      if (/(^|\s)show(\s|$)/.test(rec.oldValue || '')) continue;
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
    subtree: true, attributes: true, attributeOldValue: true,
    attributeFilter: ['class'],
  });
}

export default {
  animate, set, stop, reset, isReduced, prefersReduced, watchOverlays,
};
