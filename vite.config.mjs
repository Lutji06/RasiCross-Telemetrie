// Vite-Konfiguration (Phase 42). base './': das gepackte Electron laedt
// dist/index.html per loadFile (file://) -- Asset-Pfade muessen relativ sein.
// .mjs: Vite 8 laedt die Config als ESM (Root-package.json bleibt CommonJS).
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Debugbarkeit im Feld: lesbare Stacktraces in der gepackten App
    sourcemap: true,
  },
});
