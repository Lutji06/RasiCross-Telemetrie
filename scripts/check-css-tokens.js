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
    // Phase 50: Skalen-Gate. font-size <=20px nur als var(--fs-*);
    // padding/gap/margin-px nur auf der sp-Skala; border-radius >=6px
    // nur als var(--r-*) (999px-Pille inklusive).
    const fs = line.match(/font-size\s*:\s*([\d.]+)px/);
    if (fs && parseFloat(fs[1]) <= 20) {
      console.error(p + ':' + (i + 1) + ' font-size ' + fs[1] + 'px roh -- var(--fs-*) nutzen'); bad++;
    }
    const SP = [2, 4, 6, 8, 10, 12, 14, 18, 24];
    const sp = line.match(/(?<![a-z-])(?:padding|gap|margin)\s*:\s*([^;}]+)/);
    if (sp) {
      for (const part of sp[1].trim().split(/\s+/)) {
        const px = part.match(/^-?([\d.]+)px$/);
        if (px && parseFloat(px[1]) !== 0 && !SP.includes(parseFloat(px[1]))) {
          console.error(p + ':' + (i + 1) + ' Abstand ' + part + ' nicht auf sp-Skala'); bad++;
        }
      }
    }
    const br = line.match(/border-radius\s*:\s*([\d.]+)px/);
    if (br && parseFloat(br[1]) >= 6) {
      console.error(p + ':' + (i + 1) + ' radius ' + br[1] + 'px roh -- var(--r-*) nutzen'); bad++;
    }
  });
});
walk('src/styles');
if (/<style/i.test(fs.readFileSync('index.html', 'utf8'))) {
  console.error('index.html: <style> gefunden -- CSS gehoert nach src/styles/');
  bad++;
}
if (bad) process.exit(1);
console.log('CSS-Token-Gate: OK');
