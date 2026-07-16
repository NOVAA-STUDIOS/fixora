import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

import { DEV_CSP_NONCE } from './electron/main/security/csp.js';

/**
 * The `<meta>` CSP in index.html is the production "second lock" (Electronegativity reads it, and
 * csp.test asserts it matches the shipped header). In dev, though, it would also apply — and it has
 * no nonce, so it would block the Fast-Refresh preamble the header CSP deliberately allows. So in the
 * dev server only, strip the meta tag; the header CSP (set by main) governs the running dev app. The
 * built HTML keeps the strict meta untouched.
 */
const stripCspMetaInDev: Plugin = {
  name: 'fixora-strip-csp-meta-dev',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace(/<meta\b[^>]*Content-Security-Policy[^>]*>/i, '');
  },
};

/**
 * The analysis utility process (ADR-017) is authored as ESM and NOT bundled: it imports the ESM
 * engine (`@fixora/core-analysis`), which loads tree-sitter WASM via `import.meta.url` — that only
 * resolves when it stays a real module in node_modules. So we copy the worker next to the CJS main
 * bundle; main forks it by path. (M8 packaging unpacks it + the WASM from the ASAR.)
 */
const copyAnalysisWorker: Plugin = {
  name: 'fixora-copy-analysis-worker',
  closeBundle() {
    copyFileSync(
      resolve(__dirname, 'electron/workers/analysis-worker.mjs'),
      resolve(__dirname, 'out/main/analysis-worker.mjs'),
    );
  },
};

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
const BUNDLED = [
  '@fixora/shared-types',
  '@fixora/shared-types/channels',
  '@fixora/tokens',
  'zod',
  // chokidar@5 is ESM-only; the main bundle is CJS, so a `require('chokidar')` would fail. Bundle
  // it in (it is pure JS in v4+). `ignore` is CJS and can stay external.
  'chokidar',
];
export default defineConfig({
  main: {
    plugins: [copyAnalysisWorker],
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
    plugins: [react(), tailwindcss(), stripCspMetaInDev],
    // A fixed CSP nonce. In dev, Vite stamps it on the scripts it injects — including
    // `@vitejs/plugin-react`'s inline Fast-Refresh preamble — so the strict CSP can allow that
    // preamble via `'nonce-…'` (a nonce is not `'unsafe-inline'`; ADR-006's rule holds). In the
    // production build there is no inline script; the nonce attribute on the bundled `<script>` is
    // harmless (it is allowed by `'self'`), so the shipped policy is untouched.
    html: { cspNonce: DEV_CSP_NONCE },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
});
