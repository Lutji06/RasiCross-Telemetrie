# Phase 65 — Live-Tab Seitenkonzept Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Live-Tab wird ein Blätterwerk — Seite 0 ist die Übersicht mit Karte, Leaderboard und Geschwindigkeiten, Seite 1..n je ein Kart — und zwei Multi-Kart-Fehler verschwinden.

**Architecture:** Ein pures Seitenmodell (`live-view.js`, `node:test`-abgedeckt) leitet aus Kart-Liste und gewünschter Seite `{page, view, mac}` ab. `state.liveView` und `body[data-live-view]` bleiben als abgeleitete Schnittstelle bestehen, damit CSS, `kart-overview.js` und die Screenshot-Tests unverändert weiterlaufen. Das Übersichts-Layout entsteht per CSS-Grid auf `#tab-live` — ein Canvas, kein DOM-Verschieben. Die Registry bekommt einen Lesezugriff, der nichts anlegt.

**Tech Stack:** Vanilla ESM (Konvention Phase 42), `node:test`, Vite-Bundle, Electron, Playwright. Keine neue Laufzeit-Abhängigkeit.

**Spec:** `docs/superpowers/specs/2026-09-02-65-live-tab-seitenkonzept-design.md`

## Global Constraints

- **Keine neue Runtime-Abhängigkeit.** `package.json` bleibt bei serialport, electron-updater, three.
- **Pure Logik als dependency-freies ESM-Objektmodul** mit `export default {...}` (Stil `geo.js`, `spring.js`, `live-view.js`), `node:test`-abgedeckt, wirft nie.
- **DOM-Verdrahtung wird nicht unit-getestet** — `node --check`, statischer Grep und manuelle Abnahme (Hausregel seit Phase 42).
- **Dateien sind CRLF.** Vor jedem Edit die Zielstelle frisch lesen und den Anker aus diesem Read kopieren. Zur Verifikation das Grep-Tool benutzen, nicht Shell-Grep.
- **`MAX_KARTS` bleibt 4.** Kein Anfassen von `kart-rank.js`, `lap-engine.js` oder der Kartenzeichnung.
- **Schnittstelle bleibt:** `state.liveView ∈ {'single','overview'}` und `document.body.dataset.liveView` existieren weiter.

## Ist-Zustand, der den Zuschnitt bestimmt

- `setLiveView(mode, manual)` (`live-ui.js:489`) wird an fünf Stellen gerufen: `kart-bar.js:33`, `kart-bar.js:60`, `kart-overview.js:140`, `live-ui.js:546`, `live-ui.js:573`.
- `.pw-live-body` ist bereits ein Grid `2fr 1fr` (`live-compact.css:110`); `.pw-live-laps` liegt **innerhalb** `.pw-live-map` (`live-compact.css:116`).
- `#liveLeaderStrip`, `.pw-liverow`, `.pw-live-body` und `#liveOverview` sind alle direkte Kinder von `#tab-live` — deshalb genügt ein Grid auf `#tab-live`, um sie neu anzuordnen.
- `renderLeaderStrip()` setzt `el.style.display` selbst auf `'none'` bzw. `'flex'`.

## File Structure

| Datei | Verantwortung nach der Änderung |
| --- | --- |
| `src/live-view.js` | **nur** das pure Seitenmodell (`resolvePage`) |
| `test/live-view.test.js` | dessen Tests |
| `src/kart-registry.js` | Registry + neuer Lesezugriff `peek()` |
| `test/kart-registry.test.js` | dessen Tests |
| `src/store.js` | `activeKart()` liest ohne anzulegen; Settings-Default entfällt |
| `src/live-ui.js` | `setLivePage()` als einziger Seitenwechsel; Leaderboard auch auf Seite 0 |
| `src/kart-bar.js` | Chips als Seitenwahl |
| `src/kart-overview.js` | Kachel-Klick blättert zur Kart-Seite |
| `src/styles/pages/live-compact.css` | Übersichts-Grid statt Ausblenden |
| `index.html`, `src/settings.js`, `src/settings-ui.js` | Einstellung „Live-Start-Ansicht" entfernt |

---

### Task 1: Pures Seitenmodell

**Files:**
- Modify: `src/live-view.js` (ersetzt `liveViewAutoReducer` und `START_MODES` vollständig)
- Modify: `test/live-view.test.js` (ersetzt den kompletten Inhalt)

**Interfaces:**
- Consumes: nichts.
- Produces: `RasiLiveView.resolvePage({ macs, page, wantMac })` → `{ page: number, view: 'overview'|'single', mac: string|null }`. Wird in Task 4, 5 und 6 benutzt.

- [ ] **Step 1: Den Test zuerst schreiben**

`test/live-view.test.js` **vollständig** durch diesen Inhalt ersetzen:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import LV from '../src/live-view.js';

const M3 = ['a', 'b', 'c'];
const P = (o) => LV.resolvePage(o);

test('exports the pure api', () => {
  assert.equal(typeof LV.resolvePage, 'function');
});

test('Seite 0 ist die Uebersicht, 1..n je ein Kart', () => {
  assert.deepEqual(P({ macs: M3, page: 0 }), { page: 0, view: 'overview', mac: null });
  assert.deepEqual(P({ macs: M3, page: 1 }), { page: 1, view: 'single', mac: 'a' });
  assert.deepEqual(P({ macs: M3, page: 3 }), { page: 3, view: 'single', mac: 'c' });
});

test('ein einziges Kart hat keine Uebersicht', () => {
  assert.deepEqual(P({ macs: ['a'], page: 0 }), { page: 1, view: 'single', mac: 'a' });
  assert.deepEqual(P({ macs: ['a'], page: 1 }), { page: 1, view: 'single', mac: 'a' });
});

test('gar kein Kart: keine Seite, kein mac', () => {
  assert.deepEqual(P({ macs: [], page: 0 }), { page: 1, view: 'single', mac: null });
});

test('Seiten ausserhalb des Bereichs werden geklemmt', () => {
  assert.equal(P({ macs: M3, page: 9 }).page, 3);
  assert.equal(P({ macs: M3, page: -4 }).page, 0);
});

test('wantMac gewinnt und waehlt dessen Seite', () => {
  assert.deepEqual(P({ macs: M3, page: 0, wantMac: 'b' }), { page: 2, view: 'single', mac: 'b' });
});

test('verschwundenes wantMac faellt auf die Uebersicht zurueck', () => {
  assert.deepEqual(P({ macs: M3, page: 2, wantMac: 'weg' }), { page: 0, view: 'overview', mac: null });
});

test('verschwundenes wantMac bei einem Kart landet auf dessen Seite', () => {
  assert.deepEqual(P({ macs: ['a'], page: 1, wantMac: 'weg' }), { page: 1, view: 'single', mac: 'a' });
});

test('ein neues Kart aendert die aktuelle Seite nicht', () => {
  const vorher = P({ macs: ['a', 'b'], page: 2 });
  const nachher = P({ macs: ['a', 'b', 'c'], page: vorher.page });
  assert.equal(nachher.page, 2);
  assert.equal(nachher.mac, 'b');
});

test('Junk-Eingaben werfen nie', () => {
  assert.doesNotThrow(() => P({}));
  assert.doesNotThrow(() => P(null));
  assert.doesNotThrow(() => P({ macs: 'keinArray', page: NaN, wantMac: 7 }));
  assert.deepEqual(P(null), { page: 1, view: 'single', mac: null });
  assert.equal(P({ macs: M3, page: NaN }).page, 0);
});
```

- [ ] **Step 2: Test laufen lassen, Rot bestätigen**

Run: `node --test test/live-view.test.js`
Expected: FAIL — `LV.resolvePage is not a function`.

- [ ] **Step 3: Modul schreiben**

`src/live-view.js` **vollständig** durch diesen Inhalt ersetzen:

```js
'use strict';
/*!
 * live-view.js — pure Logik fuer die Seiten des Live-Tabs (Phase 65):
 *   Seite 0 = Uebersicht, Seite 1..n = je ein Kart.
 * Loest liveViewAutoReducer aus Phase 55 ab: Die Uebersicht ist jetzt
 * Seite 1 eines Blaetterwerks und braucht keine Start-Automatik mehr.
 * Reines Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */

function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Leitet aus Kart-Liste und gewuenschter Seite die gueltige Seite ab.
//   macs    : MAC-Liste in Reihenfolge der Chip-Leiste
//   page    : gewuenschte Seite (0 = Uebersicht)
//   wantMac : optional — dieses Kart anzeigen; gewinnt ueber page
// -> { page, view, mac }
function resolvePage(a) {
  const o = a || {};
  const macs = Array.isArray(o.macs) ? o.macs.filter(m => typeof m === 'string') : [];
  const n = macs.length;
  // Ohne zweites Kart gibt es nichts zu vergleichen -- die Uebersicht
  // entfaellt, damit Einzelfahrer nicht durch eine Ein-Kachel-Seite muessen.
  if (n <= 1) return { page: 1, view: 'single', mac: n ? macs[0] : null };
  let page;
  if (typeof o.wantMac === 'string' && o.wantMac) {
    const i = macs.indexOf(o.wantMac);
    // Unbekanntes Kart (gerade verschwunden): zurueck auf die Uebersicht,
    // statt stumm ein fremdes Kart anzuzeigen.
    page = i < 0 ? 0 : i + 1;
  } else {
    const raw = Number(o.page);
    page = _clamp(isFinite(raw) ? Math.trunc(raw) : 0, 0, n);
  }
  return page === 0
    ? { page: 0, view: 'overview', mac: null }
    : { page: page, view: 'single', mac: macs[page - 1] };
}

export default { resolvePage };
```

- [ ] **Step 4: Test laufen lassen, Grün bestätigen**

Run: `node --test test/live-view.test.js`
Expected: PASS, alle Tests grün.

- [ ] **Step 5: Lint + Restsuite**

Run: `npm run lint` → 0 Befunde. `npm test` → alles grün **außer** den Modulen, die `liveViewAutoReducer` noch importieren; falls `live-ui.js` bricht, ist das erwartet und wird in Task 4 behoben. `node --check src/live-view.js`.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/live-view.js test/live-view.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(live): pures Seitenmodell fuer den Live-Tab (Phase 65)

Seite 0 ist die Uebersicht, Seite 1..n je ein Kart. Die Start-Automatik
aus Phase 55 entfaellt: Als erste Seite eines Blaetterwerks braucht die
Uebersicht keine Regel mehr, wann sie erscheint. Ein einzelnes Kart hat
keine Uebersicht, ein verschwundenes Kart faellt dorthin zurueck.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Registry — Lesen legt nichts an

**Files:**
- Modify: `src/kart-registry.js` (Anker: `function get(mac) {` bei Zeile 64 und der Rückgabe-Block ab `return {`)
- Modify: `test/kart-registry.test.js` (Tests ergänzen)

**Interfaces:**
- Consumes: nichts.
- Produces: `registry.peek(mac)` → Kart-Objekt oder `null`, **ohne** die Liste zu verändern. Wird in Task 3 benutzt.

- [ ] **Step 1: Den Test zuerst schreiben**

An `test/kart-registry.test.js` anhängen:

```js
test('peek liest ohne zu registrieren', () => {
  const r = KartRegistry.create();
  assert.strictEqual(r.peek('aa:bb'), null);
  assert.deepStrictEqual(r.macs(), []);
  assert.strictEqual(r.has('aa:bb'), false);
});

test('peek liefert den Bucket, sobald er per get angelegt wurde', () => {
  const r = KartRegistry.create();
  const k = r.get('aa:bb');
  assert.strictEqual(r.peek('aa:bb'), k);
  assert.deepStrictEqual(r.macs(), ['aa:bb']);
});

test('peek macht kein Kart aktiv', () => {
  const r = KartRegistry.create();
  r.peek('aa:bb');
  assert.strictEqual(r.activeMac(), null);
});
```

- [ ] **Step 2: Test laufen lassen, Rot bestätigen**

Run: `node --test test/kart-registry.test.js`
Expected: FAIL — `r.peek is not a function`.

- [ ] **Step 3: `peek` ergänzen**

In `src/kart-registry.js` direkt **nach** der `has`-Funktion einfügen:

```js
    // Phase 65: Lesezugriff, der nichts anlegt. get() registriert jede
    // unbekannte MAC -- ein einziger Lesezugriff von activeKart() erzeugte
    // so den default-Bucket, der danach als tote Kachel in der Liste stand
    // und einen der vier Plaetze belegte.
    function peek(mac) { return has(mac) ? karts[mac] : null; }
```

Und im Rückgabe-Objekt `get: get,` um eine Zeile ergänzen:

```js
      get: get,
      peek: peek,
```

- [ ] **Step 4: Test laufen lassen, Grün bestätigen**

Run: `node --test test/kart-registry.test.js` → PASS. Danach `npm test`.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/kart-registry.js test/kart-registry.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(karts): Lesezugriff peek(), der keine Karts anlegt (Phase 65)

get() registriert jede unbekannte MAC. Damit erzeugte schon ein einziger
Lesezugriff einen Kart-Eintrag -- die Grundlage des default-Phantoms.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `activeKart()` liest, ohne anzulegen

**Files:**
- Modify: `src/store.js` (Anker: `function activeKart() {` bei Zeile 50)

**Interfaces:**
- Consumes: `registry.peek()` aus Task 2, `KartRegistry.makeKartState()`.
- Produces: `activeKart()` bleibt namens- und signaturgleich und liefert weiterhin **immer** ein Objekt.

- [ ] **Step 1: Fallback ohne Registrierung**

Die Funktion

```js
function activeKart() {
  let k = state.karts.active();
  if (!k) k = state.karts.get(KartRegistry.DEFAULT_MAC);   // single-source fallback
  return k;
}
```

ersetzen durch:

```js
// Phase 65: Leerzustand ausserhalb der Registry. Vorher legte der
// Fallback per get() den default-Bucket an -- er erschien danach als
// tote Kachel, als zweiter Chip bei nur einem Kart und belegte einen
// der vier Plaetze. Lesen darf nichts anlegen; der Schreibpfad
// (kartFor) registriert weiterhin, damit Pakete ohne from_mac wie
// bisher auf DEFAULT_MAC landen koennen.
let _emptyKart = null;
function activeKart() {
  const k = state.karts.active() || state.karts.peek(KartRegistry.DEFAULT_MAC);
  if (k) return k;
  if (!_emptyKart) _emptyKart = KartRegistry.makeKartState();
  return _emptyKart;
}
```

- [ ] **Step 2: Verifizieren**

Run: `node --check src/store.js` und `npm test`.
Mit dem Grep-Tool nach `karts.get(KartRegistry.DEFAULT_MAC)` über `src/` suchen → **0 Treffer**.
Mit dem Grep-Tool nach `kartFor` über `src/store.js` suchen → die Funktion muss unverändert `get()` benutzen.

- [ ] **Step 3: Funktionsnachweis am laufenden Programm**

`e2e/_tmp-default.spec.js` anlegen:

```js
'use strict';
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

test('kein default-Phantom in der Kart-Liste', async () => {
  const { app, page, userData } = await launchApp();
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#demoChip');
  await page.waitForFunction(() => RasiTest.state.karts.macs().length >= 3);
  await page.waitForTimeout(3000);
  const macs = await page.evaluate(() => RasiTest.state.karts.macs());
  console.log('MACS=' + JSON.stringify(macs));
  expect(macs).not.toContain('default');
  expect(macs.length).toBe(3);
  await closeApp(app, userData);
});
```

Run: `npx vite build && npx playwright test e2e/_tmp-default.spec.js`
Expected: PASS, Ausgabe ohne `"default"`. **Danach die Datei löschen** — sie ist ein Wegwerf-Nachweis.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/store.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
fix(karts): default-Phantom verschwindet aus der Kart-Liste (Phase 65)

activeKart() legte per get() einen Bucket an, sobald es einmal las. Der
Eintrag empfing nie ein Paket, stand aber dauerhaft in macs(): als tote
Kachel mit 0 km/h, als zweiter Chip bei nur einem Kart und als belegter
vierter Platz -- ein viertes echtes Kart haette keinen mehr bekommen.
Nachgemessen im Demo-Modus: vorher vier Eintraege, danach drei.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Seitenwechsel — `live-ui.js` und alle Aufrufer

> Diese Task fasst Motor und Aufrufer zusammen: `live-ui.js` allein waere
> nicht lauffaehig, weil `kart-bar.js` und `kart-overview.js` noch die
> alte Funktion riefen. Erst beide zusammen ergeben einen testbaren Stand.

**Files:**
- Modify: `src/live-ui.js` (Anker: `function setLiveView(mode, manual) {` Zeile 489; `renderLeaderStrip` Zeile 508 und 513; der Block `let _liveViewManual = false;` bis Ende `autoLiveView()` Zeile 556–567; `refreshOverview()` Zeile 571–575; Marker-Zeile 639 und Export-Zeile 646)

**Interfaces:**
- Consumes: `RasiLiveView.resolvePage` aus Task 1.
- Produces: `setLivePage(page, wantMac)` — exportiert; ersetzt `setLiveView`. Wird in dieser Task von `kart-bar.js` und `kart-overview.js` benutzt. `refreshOverview` und `renderLeaderStrip` behalten Namen und Signatur.

- [ ] **Step 1: `setLiveView` durch `setLivePage` ersetzen**

Die Funktion `setLiveView` samt ihres Kommentarblocks ersetzen durch:

```js
// Phase 65: Der Live-Tab blaettert. Seite 0 ist die Uebersicht, Seite
// 1..n je ein Kart. Welche Seite gueltig ist, entscheidet das pure
// Modell in live-view.js; hier wird nur gespiegelt und gezeichnet.
// state.liveView und body[data-live-view] bleiben als abgeleitete
// Schnittstelle bestehen -- CSS und kart-overview.js haengen daran.
// _livePage ist die ABSICHT des Nutzers, nicht die geklemmte Seite.
// Der Unterschied zaehlt beim Start: Da gibt es noch kein Kart, die
// Aufloesung ergaebe Seite 1 -- wuerde man die zurueckschreiben, landete
// man nie auf der Uebersicht, sobald Karts erscheinen.
let _livePage = 0;
function _applyPage(r) {
  if (r.mac && state.karts.setActive(r.mac)) state.activeKartMac = r.mac;
  state.liveView = r.view;
  document.body.dataset.liveView = r.view;
  RasiKartBar.render(state);
  renderLeaderStrip();
  if (r.view === 'overview') RasiKartOverview.render(state);
  // Canvas-Groessen neu messen: die Karte wechselt zwischen Uebersichts-
  // und Kart-Raster die Breite, und in der Uebersicht war sie frueher
  // ganz versteckt.
  setTimeout(() => { try { resizeCanvases(); } catch (e) {} }, 50);
}
function setLivePage(page, wantMac) {
  const byMac = typeof wantMac === 'string' && !!wantMac;
  const r = RasiLiveView.resolvePage({
    macs: state.karts.macs(), page: page, wantMac: wantMac,
  });
  // Bei Kart-Wahl ist die aufgeloeste Seite die Absicht; bei Seitenwahl
  // die gewuenschte Zahl, damit "Uebersicht" Absicht bleibt, solange es
  // noch kein zweites Kart gibt.
  const want = Number(page);
  _livePage = byMac ? r.page : (isFinite(want) ? Math.trunc(want) : 0);
  _applyPage(r);
}

```

- [ ] **Step 2: Leaderboard auch auf Seite 0 rendern**

In `renderLeaderStrip()` die Zeile

```js
    const rr = (state.liveView !== 'overview')
      ? RasiKartRank.ranking(state, r) : null;
```

ersetzen durch:

```js
    // Phase 65: Das Leaderboard gehoert auf beide Seitenarten. Auf der
    // Uebersicht steht es als hohe Liste rechts neben der Karte, auf den
    // Kart-Seiten als flacher Streifen -- derselbe Renderer, zwei
    // Darstellungen, unterschieden per CSS-Klasse.
    const rr = RasiKartRank.ranking(state, r);
```

Und direkt nach `el.style.display = 'flex';` einfügen:

```js
    el.classList.toggle('ls-column', state.liveView === 'overview');
```

- [ ] **Step 3: Den Klick im Leaderboard auf Seiten umstellen**

In `renderLeaderStrip()` die Zeilen

```js
          state.activeKartMac = mac;
          setLiveView('single', true);
```

ersetzen durch:

```js
          setLivePage(null, mac);
```

- [ ] **Step 4: Automatik entfernen**

Den kompletten Block von

```js
// Phase 55: Start-Automatik der Live-Ansicht. Session-Zustand: Hand-Wahl-Flag
```

bis zum Ende von `autoLiveView()` (schließende Klammer nach `if (next && next !== state.liveView) setLiveView(next);`) **ersatzlos löschen**, inklusive `let _liveViewManual = false;` und `let _prevKartCount = 0;`.

- [ ] **Step 5: `refreshOverview` auf das Seitenmodell heben**

Die Funktion

```js
function refreshOverview() {
  if (state.liveView !== 'overview') return;
  if (state.karts.macs().length <= 1) { setLiveView('single'); return; }
  RasiKartOverview.render(state);
}
```

ersetzen durch:

```js
// Im 1-Hz-/200-ms-Loop aufgerufen. Haelt das Kachel-Raster aktuell und
// zieht die Seite nach, wenn Karts dazukommen oder verschwinden -- das
// Klemmen entscheidet das pure Modell, nicht diese Funktion.
function refreshOverview() {
  const r = RasiLiveView.resolvePage({
    macs: state.karts.macs(), page: _livePage,
    wantMac: _livePage === 0 ? null : state.activeKartMac,
  });
  // Nur die Darstellung nachziehen -- _livePage bleibt die Absicht.
  if (r.view !== state.liveView || (r.mac && r.mac !== state.activeKartMac)) {
    _applyPage(r);
    return;
  }
  if (state.liveView === 'overview') RasiKartOverview.render(state);
}
```

- [ ] **Step 6: Aufrufer von `autoLiveView` entfernen**

Mit dem Grep-Tool nach `autoLiveView` über `src/` suchen und **jede** Fundstelle löschen (Aufruf im Loop, Marker-Zeile, Export). Ebenso `setLiveView` in der Marker-Zeile (Zeile 639) und der Export-Zeile (646) durch `setLivePage` ersetzen.

- [ ] **Step 7: Verifizieren**

Run: `node --check src/live-ui.js`
Mit dem Grep-Tool nach `setLiveView` über `src/` suchen → nur noch Treffer in `kart-bar.js` und `kart-overview.js` (werden in Task 5 erledigt).
Mit dem Grep-Tool nach `liveViewAutoReducer|autoLiveView|_liveViewManual|liveStartView` über `src/live-ui.js` suchen → **0 Treffer**.

- [ ] **Step 8: `kart-bar.js` umstellen**

Weitere Dateien ab hier: `src/kart-bar.js` (Anker: `import { setLiveView } from './live-ui.js';` Zeile 10; `ovBtn.onclick` Zeile 33; `chip.querySelector('.kart-chip-main').onclick` Zeile 56–62) und `src/kart-overview.js` (Anker: `import { setLiveView } from './live-ui.js';` Zeile 14; `card.onclick` Zeile 136–142).

Import ersetzen:

```js
import { setLivePage } from './live-ui.js';
```

Übersicht-Knopf: `ovBtn.onclick = () => { setLiveView('overview', true); };` ersetzen durch

```js
    ovBtn.onclick = () => { setLivePage(0); };
```

Chip-Klick: den Block

```js
      chip.querySelector('.kart-chip-main').onclick = () => {
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          // Chip-Klick wählt immer die Einzelansicht dieses Karts.
          setLiveView('single', true);
        }
      };
```

ersetzen durch:

```js
      chip.querySelector('.kart-chip-main').onclick = () => {
        // Phase 65: Der Chip ist die Seitenwahl -- setLivePage setzt das
        // aktive Kart selbst, sobald die Seite aufgeloest ist.
        setLivePage(null, mac);
      };
```

- [ ] **Step 9: `kart-overview.js` umstellen**

Import ersetzen:

```js
import { setLivePage } from './live-ui.js';
```

Kachel-Klick: den Block

```js
      card.onclick = () => {
        const mac = card.getAttribute('data-mac');
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          setLiveView('single', true);
        }
      };
```

ersetzen durch:

```js
      card.onclick = () => {
        setLivePage(null, card.getAttribute('data-mac'));
      };
```

- [ ] **Step 10: Aktiv-Zustand der Leiste prüfen**

In `kart-bar.js` die Zeile

```js
      let cls = 'kart-chip' + (mac === state.activeKartMac && state.liveView !== 'overview' ? ' active' : '');
```

bleibt unverändert — `state.liveView` wird in Task 4 weiterhin gepflegt. **Nicht anfassen.**

- [ ] **Step 11: Verifizieren**

Run: `node --check src/kart-bar.js && node --check src/kart-overview.js && node --check src/live-ui.js`
Mit dem Grep-Tool nach `setLiveView` über `src/` suchen → **0 Treffer**.
Run: `npm run lint` → 0; `npm test` → grün.

- [ ] **Step 12: Funktionstests**

Run: `npx vite build && npx playwright test e2e/app.spec.js e2e/karts.spec.js`
Expected: grün.

- [ ] **Step 13: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/live-ui.js src/kart-bar.js src/kart-overview.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(live): Live-Tab blaettert statt Modus zu wechseln (Phase 65)

setLivePage loest setLiveView ab: Chip-Leiste, Kacheln und Leaderboard
waehlen jetzt eine Seite, die Gueltigkeit entscheidet das pure Modell.
Die Start-Automatik aus Phase 55 samt Hand-Wahl-Flag entfaellt -- als
erste Seite braucht die Uebersicht keine Regel mehr, wann sie erscheint.
Das Leaderboard rendert auf beiden Seitenarten; die Darstellung
unterscheidet eine CSS-Klasse.

state.liveView und body[data-live-view] bleiben als abgeleitete
Schnittstelle bestehen, damit CSS und kart-overview.js unveraendert
weiterlaufen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Übersichts-Layout

**Files:**
- Modify: `src/styles/pages/live-compact.css` (Anker: Zeile 56 `body[data-live-view="overview"] #liveLeaderStrip{display:none !important}` und Zeilen 64–65 mit dem `.pw-liverow`/`.pw-live-body`-Block)

**Interfaces:**
- Consumes: die Klasse `ls-column`, die Task 4 auf `#liveLeaderStrip` setzt.
- Produces: nichts für andere Tasks.

- [ ] **Step 1: Ausblendregeln durch das Übersichts-Raster ersetzen**

Die Zeile

```css
body[data-live-view="overview"] #liveLeaderStrip{display:none !important}
```

**löschen.** Den Block

```css
body[data-live-view="overview"] #tab-live .pw-liverow,
body[data-live-view="overview"] #tab-live .pw-live-body{display:none}
```

ersetzen durch:

```css
/* Phase 65: Seite 0 blendet nicht mehr aus, sie ordnet um. Karte links,
   Leaderboard rechts, Kacheln unten. #liveLeaderStrip, .pw-liverow,
   .pw-live-body und #liveOverview sind alle Kinder von #tab-live --
   deshalb genuegt ein Raster auf dem Tab, ohne DOM zu verschieben.
   Zweite Spalte 'auto': laeuft kein Rennen, ist der Leaderboard
   display:none, die Spalte kollabiert auf 0 und die Karte wird breit. */
body[data-live-view="overview"] #tab-live{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  grid-template-areas:"bar bar" "map leader" "cards cards";
  gap:var(--sp-12);
  align-items:start;
}
body[data-live-view="overview"] #tab-live .pw-liverow{grid-area:bar}
body[data-live-view="overview"] #tab-live .pw-live-body{grid-area:map;display:block}
body[data-live-view="overview"] #tab-live #liveLeaderStrip{grid-area:leader;margin:0}
body[data-live-view="overview"] #tab-live #liveOverview{grid-area:cards}
/* Auf Seite 0 gehoeren Rundentabelle, KPI-Spalte und Sektoren nicht dazu --
   die stehen auf den Kart-Seiten. */
body[data-live-view="overview"] #tab-live .pw-live-laps,
body[data-live-view="overview"] #tab-live .pw-live-side{display:none}

/* Leaderboard als hohe Liste (nur Seite 0). Der flache Streifen der
   Kart-Seiten bleibt unveraendert die Standard-Darstellung. */
.leader-strip.ls-column{
  flex-direction:column;flex-wrap:nowrap;align-items:stretch;
  min-width:210px;max-height:100%;overflow:auto;
}
.leader-strip.ls-column .ls-item{justify-content:flex-start;white-space:nowrap}
.leader-strip.ls-column .ls-name{flex:1;overflow:hidden;text-overflow:ellipsis}
```

- [ ] **Step 2: Kacheln kompakter, weil sie jetzt unter der Karte stehen**

Den Block

```css
body[data-live-view="overview"] #liveOverview{
  display:grid;gap:var(--sp-12);align-content:start;overflow:auto;min-height:0;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
```

ersetzen durch:

```css
body[data-live-view="overview"] #liveOverview{
  display:grid;gap:var(--sp-12);align-content:start;min-height:0;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
```

(`auto-fit` statt `auto-fill`, damit drei Karts die Breite ausfüllen statt links zu kleben; `overflow:auto` entfällt, weil die Kacheln nicht mehr die ganze Seite sind.)

- [ ] **Step 3: Verifizieren**

Run: `npm run lint:css` → OK.
Mit dem Grep-Tool nach `data-live-view="overview"` über `src/styles/` suchen → die neuen Regeln, keine `display:none` mehr auf `.pw-live-body` oder `#liveLeaderStrip`.

- [ ] **Step 4: Sichtprüfung am laufenden Programm**

`e2e/_tmp-layout.spec.js` anlegen:

```js
'use strict';
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

test('Uebersicht zeigt Karte und Kacheln', async () => {
  const { app, page, userData } = await launchApp();
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#demoChip');
  await page.waitForFunction(() => RasiTest.state.karts.macs().length >= 3);
  await page.click('.nav-item[data-tab="live"]');
  await page.waitForFunction(() => document.body.dataset.liveView === 'overview');
  await page.waitForTimeout(2000);
  const d = await page.evaluate(() => ({
    karte: getComputedStyle(document.querySelector('#tab-live .pw-live-body')).display,
    kacheln: document.querySelectorAll('#liveOverview .ko-card').length,
    laps: getComputedStyle(document.querySelector('#tab-live .pw-live-laps')).display,
  }));
  console.log('LAYOUT=' + JSON.stringify(d));
  expect(d.karte).not.toBe('none');
  expect(d.kacheln).toBe(3);
  expect(d.laps).toBe('none');
  await closeApp(app, userData);
});
```

Run: `npx vite build && npx playwright test e2e/_tmp-layout.spec.js`
Expected: PASS. **Danach die Datei löschen.**

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/styles/pages/live-compact.css
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
feat(live): Uebersichtsseite ordnet um statt auszublenden (Phase 65)

Bisher versteckte die Uebersicht per CSS genau das, was sie zeigen soll:
Karte und Leaderboard. Beide existierten laengst und kennen alle Karts.
Jetzt traegt #tab-live auf Seite 0 ein Raster -- Karte links, Leaderboard
rechts, Kacheln unten. Kein zweites Canvas, kein DOM-Verschieben.

Die zweite Spalte ist 'auto': laeuft kein Rennen, ist der Leaderboard
display:none, die Spalte kollabiert und die Karte nimmt die volle Breite,
statt ein Loch zu lassen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Einstellung „Live-Start-Ansicht" entfernen

**Files:**
- Modify: `index.html` (Anker: der `settings-row`-Block mit `id="setLiveStartView"` bei Zeile 916–919)
- Modify: `src/settings.js` (Anker: Zeile 26, `rowId: 'setLiveStartView'`)
- Modify: `src/settings-ui.js` (Anker: Zeilen 99–100 und 135–136)
- Modify: `src/store.js` (Anker: `liveStartView: 'auto', ` in der Settings-Zeile 30)

**Interfaces:**
- Consumes: nichts.
- Produces: nichts.

- [ ] **Step 1: Markup entfernen**

In `index.html` den kompletten Block löschen:

```html
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Live-Start-Ansicht</span><span class="settings-row-desc">Ansicht des Live-Tabs bei mehreren Karts</span></div>
          <select id="setLiveStartView" data-autosave><option value="auto" selected>Automatisch</option><option value="single">Einzel</option><option value="overview">Übersicht</option></select>
        </div>
```

- [ ] **Step 2: Sucheintrag entfernen**

In `src/settings.js` die Zeile mit `rowId: 'setLiveStartView'` ersatzlos löschen.

- [ ] **Step 3: Laden und Speichern entfernen**

In `src/settings-ui.js` die beiden Zeilen

```js
  if ($('setLiveStartView')) $('setLiveStartView').value =
    RasiLiveView.START_MODES.includes(state.settings.liveStartView) ? state.settings.liveStartView : 'auto';
```

und

```js
  const _lsv = $('setLiveStartView') ? $('setLiveStartView').value : 'auto';
  state.settings.liveStartView = RasiLiveView.START_MODES.includes(_lsv) ? _lsv : 'auto';
```

ersatzlos löschen. Anschließend mit dem Grep-Tool prüfen, ob `RasiLiveView` in `settings-ui.js` noch benutzt wird — wenn nicht, den Import ebenfalls löschen.

- [ ] **Step 4: Default entfernen**

In `src/store.js` in der Settings-Zeile `liveStartView: 'auto', ` streichen. Gespeicherte Werte aus alten Installationen laufen dank `Object.assign(state.settings, d.settings)` einfach als unbenutztes Feld mit — **keine Migration nötig**.

- [ ] **Step 5: Verifizieren**

Mit dem Grep-Tool nach `liveStartView|START_MODES` über `src/`, `index.html` und `test/` suchen → **0 Treffer**.
Run: `node --check src/settings-ui.js && node --check src/store.js && node --check src/settings.js`
Run: `npm run lint` → 0; `npm test` → grün.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add index.html src/settings.js src/settings-ui.js src/store.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
refactor(settings): Live-Start-Ansicht entfaellt (Phase 65)

Die drei Modi aus Phase 55 regelten, wann die Uebersicht die Einzelansicht
ablost. Als erste Seite eines Blaetterwerks braucht sie das nicht mehr:
Seite 0 ist der Startpunkt, ausser es gibt nur ein Kart. Gespeicherte
Werte laufen als unbenutztes Feld mit, eine Migration ist nicht noetig.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Abschluss — Gates, Baselines, Plan-Doc

**Files:**
- Create: `docs/superpowers/plans/2026-09-02-65-live-tab-seitenkonzept.md` (dieser Plan)
- Modify: `e2e/screens.spec.js-snapshots/*-linux.png` (Baseline-Regen, nur nach Nutzer-Abnahme)

- [ ] **Step 1: Volle lokale Gates**

```bash
npm test
npm run lint
npm run lint:css
node --check src/geo.js && node --check src/replay.js && node --check main.js && node --check preload.js && node --check tiles.js
python -m unittest discover -s test -p "test_*.py"
```
`__pycache__` danach löschen.

- [ ] **Step 2: Lokale e2e vollständig**

Run: `npx vite build && npx playwright test e2e/demo.spec.js e2e/karts.spec.js e2e/app.spec.js e2e/replay.spec.js`
Expected: 12/12 grün.

- [ ] **Step 3: Branch pushen und CI abwarten**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push -u origin feat/phase-65-live-tab-seitenkonzept
gh run list --branch feat/phase-65-live-tab-seitenkonzept --limit 1
gh run watch <ID> --exit-status
```

- [ ] **Step 4: Screenshot-Gate — erwartete gegen unerwartete Abweichung trennen**

`smoke` wird rot. **Erwartet sind genau zwei Bilder:** `demo-live` (Übersichtslayout neu) und `demo-live-single` (Kart-Seite; ggf. minimal durch den entfallenen Chip). **Jedes weitere rote Bild ist ein Fehler**, kein Grund für einen Regen — Ursache benennen und beheben.

Artefakt `playwright-results` herunterladen, die Diff-Bilder ansehen und für jedes rote Bild die Ursache in einem Satz notieren.

- [ ] **Step 5: Baseline-Regen — nur mit Nutzer-Abnahme**

Dem Nutzer die beiden Diff-Bilder und die Ursachen vorlegen. **Erst nach ausdrücklicher Zustimmung** die neuen `*-actual.png` aus dem CI-Artefakt als `*-linux.png` committen (Verfahren siehe Memory „Screenshot-Gate-Mechanik").

- [ ] **Step 6: `graphify update .`** (nicht committen)

- [ ] **Step 7: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-09-02-65-live-tab-seitenkonzept.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -F - <<'EOF'
docs(phase-65): Plan Live-Tab Seitenkonzept

Haelt fest, warum state.liveView als abgeleitete Schnittstelle bestehen
bleibt (CSS, kart-overview und die Screenshot-Tests haengen daran) und
warum das Uebersichts-Raster auf #tab-live sitzt statt das DOM
umzubauen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

## Manuelle Abnahme (Nutzer, nicht automatisierbar)

- [ ] Mit mehreren Karts: Seite 0 zeigt Karte, Leaderboard und alle Geschwindigkeiten ohne Scrollen.
- [ ] Blättern über die Chip-Leiste fühlt sich wie Seiten an, nicht wie ein Moduswechsel.
- [ ] Ohne laufendes Rennen füllt die Karte die Breite, es bleibt kein Loch rechts.
- [ ] Mit genau einem Kart: keine Übersicht, keine Leiste — wie bisher.
- [ ] Ein viertes echtes Kart bekommt einen Platz.

## Self-Review

- **Spec-Abdeckung:** Seitenmodell → Task 1; `default`-Korrektur → Task 2+3; Kart-Leiste als Seitenwahl → Task 4 (Steps 8–9); Übersichts-Layout (Karte links, Leaderboard rechts, Kacheln unten) → Task 5; Leaderboard auf beiden Seitenarten → Task 4 Step 2; Einstellung entfernen → Task 6; Baseline-Regen mit Abnahme → Task 7 Step 4–5. Kart-Seiten bleiben unverändert — dafür gibt es bewusst **keine** Task.
- **Platzhalter:** keine. Jeder Schritt nennt Datei, Anker und vollständigen Code.
- **Typ-Konsistenz:** `resolvePage({macs, page, wantMac})` → `{page, view, mac}` wird in Task 4 (zweimal), Task 1 (Tests) mit genau dieser Form benutzt. `setLivePage(page, wantMac)` wird in Task 4 definiert und in Task 4 und 5 mit `setLivePage(0)`, `setLivePage(null, mac)` gerufen — `page: null` ist zulässig, weil `resolvePage` `Number(null) === 0` über den `wantMac`-Zweig gar nicht erst auswertet. `peek(mac)` aus Task 2 wird in Task 3 benutzt. `_applyPage(r)` ist modul-lokal in `live-ui.js` und wird nur dort gerufen.
- **Nicht angefasst:** `kart-rank.js`, `lap-engine.js`, `map-draw.js` — Ranking und Kartenzeichnung sind korrekt und kennen bereits alle Karts.
