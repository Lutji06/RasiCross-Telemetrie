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

test('alle real benutzten response-Werte rasten ein, ohne zu ueberschwingen', () => {
  // 0.12 = Druck-Feedback, 0.18 = G-Meter, 0.22 = Dialog, 0.3 = Tab,
  // 0.35 = Default. Geprueft bei 60 fps UND beim groessten erlaubten
  // Zeitschritt. Die Einrast-Pruefung ist der eigentliche Punkt: eine
  // vorige Fassung blieb gruen, waehrend die Feder nach -593 davonlief,
  // weil nur die Obergrenze geprueft wurde.
  for (const r of [0.12, 0.18, 0.22, 0.3, 0.35]) {
    for (const dt of [1 / 60, S.MAX_DT]) {
      let v = 0, vel = 0, done = false;
      for (let i = 0; i < 400 && !done; i++) {
        const res = S.springStep(v, vel, 100, dt, 1, r);
        v = res.value; vel = res.velocity; done = res.done;
        assert.ok(v <= 100 + 1e-9, 'response ' + r + ' schoss auf ' + v);
        assert.ok(v >= -1e-9, 'response ' + r + ' lief nach unten weg: ' + v);
      }
      assert.ok(done, 'response ' + r + ' bei dt ' + dt + ' ist nicht eingerastet');
      assert.equal(v, 100);
    }
  }
});

test('absurdes response rastet ein, statt davonzulaufen', () => {
  // Einzelschritt allein reicht nicht als Absicherung (siehe Testkommentar
  // oben) -- ueber viele Schritte pruefen, dass die Feder tatsaechlich
  // ankommt statt nur "irgendeinen endlichen Wert" zu liefern.
  let v = 0, vel = 0, done = false;
  for (let i = 0; i < 400 && !done; i++) {
    const r = S.springStep(v, vel, 100, 1 / 30, 1, 1e-200);
    v = r.value; vel = r.velocity; done = r.done;
    assert.ok(Number.isFinite(v), 'value war ' + v);
    assert.ok(Number.isFinite(vel), 'velocity war ' + vel);
    assert.ok(v <= 100 + 1e-9, 'schoss auf ' + v);
    assert.ok(v >= -1e-9, 'lief nach unten weg: ' + v);
  }
  assert.ok(done, 'absurdes response ist nicht eingerastet');
  assert.equal(v, 100);
});

test('absurdes damping bleibt endlich und beruhigt sich', () => {
  // velocity != 0 ist der Punkt: der Daempfungsterm ist 2*z*omega*vel --
  // mit vel = 0 haette z ueberhaupt keine Wirkung und der Test wuerde die
  // Klammer gar nicht pruefen (so war eine fruehere Fassung zahnlos).
  let v = 0, vel = 500;
  for (let i = 0; i < 100; i++) {
    const r = S.springStep(v, vel, 100, S.MAX_DT, 1e9, 0.12);
    v = r.value; vel = r.velocity;
    assert.ok(Number.isFinite(v), 'value wurde ' + v + ' in Schritt ' + i);
    assert.ok(Number.isFinite(vel), 'velocity wurde ' + vel + ' in Schritt ' + i);
    assert.ok(Math.abs(v) < 1e6, 'value lief weg: ' + v);
    if (r.done) break;
  }
});

test('unterdaempft schwingt ueber und kommt zur Ruhe', () => {
  // Daempfung 0.8 ist im Modulkopf ausdruecklich vorgesehen -- nach einer
  // Geste, die selbst Schwung erzeugt hat. Dieser Pfad muss ueberschwingen
  // duerfen UND einrasten.
  let v = 0, vel = 0, max = 0, done = false;
  for (let i = 0; i < 600 && !done; i++) {
    const r = S.springStep(v, vel, 100, 1 / 60, 0.8, 0.35);
    v = r.value; vel = r.velocity; done = r.done;
    if (v > max) max = v;
  }
  assert.ok(max > 100, 'unterdaempft muss ueberschwingen, Maximum war ' + max);
  assert.ok(done, 'muss trotzdem zur Ruhe kommen');
  assert.equal(v, 100);
});
