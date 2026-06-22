'use strict';
// Guard: jedes lokale <script src="*.js"> in der HTML muss im electron-builder
// `files`-Whitelist stehen, sonst fehlt es im gepackten Build (404 ->
// ReferenceError beim Laden -> tote App). Regression aus Phase 28:
// kart-registry.js/kart-bar.js waren referenziert, aber nicht gewhitelistet.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function scriptSrcsFromHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'RasiCross_Telemetry.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

test('alle lokalen HTML-Scripts stehen im electron-builder files-Whitelist', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = pkg.build.files;
  // vendor/** deckt vendor-Scripts per Glob ab; nur lokale .js explizit pruefen.
  const localScripts = scriptSrcsFromHtml().filter(
    (s) => s.endsWith('.js') && !s.startsWith('vendor/')
  );
  const missing = localScripts.filter((s) => !files.includes(s));
  assert.deepStrictEqual(missing, [],
    'Diese in der HTML referenzierten Scripts fehlen im Build-Whitelist: ' + missing.join(', '));
});
