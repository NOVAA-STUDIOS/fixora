import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * Three build targets, three trust levels. `main` and `preload` are Node; `renderer` is a
 * sandboxed browser and is built as one — it never gets a Node polyfill, an `externalizeDeps`
 * escape hatch, or a `nodeIntegration` shim, because the day it does, invariant I2 is gone
 * and nobody will have noticed.
 */
export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'electron/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'electron/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: import.meta.dirname,
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'index.html') },
      },
    },
  },
});
