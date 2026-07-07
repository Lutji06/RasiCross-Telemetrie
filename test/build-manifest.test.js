// Guard (Phase 42): electron-builder paketiert den Vite-Build. Whitelist
// muss main/preload/tiles/dist/icon enthalten; index.html darf nur noch
// EIN Modul-Script referenzieren (klassische <script src> waeren im
// Vite-Build tote Referenzen).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('build.files enthaelt Hauptprozess-Dateien und dist/**', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const f of ['main.js', 'preload.js', 'tiles.js', 'dist/**', 'icon.ico']) {
    assert.ok(pkg.build.files.includes(f), 'fehlt in build.files: ' + f);
  }
});

test('index.html laedt genau ein Modul-Script und keine klassischen Scripts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const moduleTags = html.match(/<script\s+type="module"\s+src="[^"]+"/g) || [];
  assert.strictEqual(moduleTags.length, 1);
  const classicTags = (html.match(/<script\s+src="[^"]+"/g) || []);
  assert.deepStrictEqual(classicTags, []);
});
