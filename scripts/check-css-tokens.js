'use strict';
// CI-Gate (Phase 49): Farbwerte gehoeren nach tokens.css.
// (1) Kein rohes #hex ausserhalb von src/styles/tokens.css
// (2) index.html enthaelt keinen <style>-Block mehr
const fs = require('fs');
const path = require('path');

let bad = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!e.name.endsWith('.css') || e.name === 'tokens.css') return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/#[0-9a-fA-F]{3,8}\b/);
    if (m) { console.error(p + ':' + (i + 1) + ' rohes Hex ' + m[0] + ' -- Token in tokens.css anlegen'); bad++; }
  });
});
walk('src/styles');
if (/<style/i.test(fs.readFileSync('index.html', 'utf8'))) {
  console.error('index.html: <style> gefunden -- CSS gehoert nach src/styles/');
  bad++;
}
if (bad) process.exit(1);
console.log('CSS-Token-Gate: OK');
