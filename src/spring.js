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
  // Stabilitaetsgrenze des Verfahrens: der groesste Eigenwert der
  // Zustandsmatrix ueberschreitet 1 bei h = dt*omega = 0.83 -- darueber
  // laeuft die Feder davon statt anzukommen. 0.5 haelt sicheren Abstand
  // und kostet hoechstens vier Teilschritte pro Frame.
  const H_SAFE = 0.5;
  // Untergrenze fuer response: darunter waechst omega so stark, dass
  // omega*omega in Doubles ueberlaeuft (response 1e-200 -> Infinity).
  const MIN_RESPONSE = 0.02;
  const MAX_DAMPING = 10;

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
    if (z > MAX_DAMPING) z = MAX_DAMPING;
    let r = Number(response);
    if (!isFinite(r) || r <= 0) r = RESPONSE;
    if (r < MIN_RESPONSE) r = MIN_RESPONSE;
    // Halbimplizites Euler-Verfahren: erst die Geschwindigkeit aus der
    // aktuellen Auslenkung, dann die Position aus der neuen Geschwindigkeit.
    // Stabiler als explizites Euler bei den hier ueblichen Schrittweiten.
    // In n Teilschritte zerlegt, damit jeder Teilschritt h = dt/n * omega
    // unter H_SAFE bleibt -- sonst laeuft die Feder davon statt anzukommen
    // (siehe H_SAFE oben). Bei hoher Daempfung z wird die Grenze frueher
    // bindend als bei z=1 (Determinante der Zustandsmatrix verlangt
    // h*omega*z < 1) -- deshalb wird der Teilschritt zusaetzlich durch z
    // geteilt, sonst divergiert z.B. der geklammerte MAX_DAMPING-Fall.
    const omega = (2 * Math.PI) / r;
    let n = Math.ceil((step * omega * Math.max(1, z)) / H_SAFE);
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 256) n = 256;
    const h = step / n;
    for (let i = 0; i < n; i++) {
      const accel = -(omega * omega) * (v - t) - (2 * z * omega) * vel;
      vel += accel * h;
      v += vel * h;
    }
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
