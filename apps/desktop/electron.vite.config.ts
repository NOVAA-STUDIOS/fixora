import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * Three build targets, three trust levels. `main` and `preload` are Node; `renderer` is a
 * sandboxed browser and is built as one — it never gets a Node polyfill, an `externalizeDeps`
 * escape hatch, or a `nodeIntegration` shim, because the day it does, invariant I2 is gone
 * and nobody will have noticed.
 *
 * `main` and `preload` build to **CommonJS**. That is not a preference: Electron does not
 * support an ESM preload in a sandboxed renderer, and `sandbox: true` is mandatory
 * (Security §2). The CJS output is what the security posture costs, and it is cheap.
 */

/**
 * Our own packages are bundled into main/preload rather than externalised. They are ESM-only
 * source we own, and a CJS `require()` of an ESM package fails at runtime — which is exactly
 * how this was found. Bundling also keeps the shipped ASAR self-contained, which matters for
 * the < 120 MB installer budget (PRD §7).
 */
const BUNDLED = ['@fixora/shared-types', '@fixora/shared-types/channels', '@fixora/tokens', 'zod'];
export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: BUNDLED },
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: BUNDLED },
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
});
