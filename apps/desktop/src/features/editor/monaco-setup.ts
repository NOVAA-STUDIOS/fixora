/* eslint-disable import-x/default -- Vite `?worker` virtual modules do export a default (a Worker
   constructor), but the import resolver behind import-x cannot follow the `?worker` suffix. */
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

import { ensureThemes } from './monaco-theme.js';

/**
 * Monaco, configured to run under our strict CSP — **no `unsafe-eval`, no CDN** (ADR-006, TDD §3.2).
 * Two things make that work:
 *
 *   1. We import from `monaco-editor/esm`, so there is no AMD loader and no `eval`-based module
 *      loading — the thing that historically forces Electron apps to grant `unsafe-eval`.
 *   2. Language workers are Vite `?worker` imports, bundled locally and loaded as blob/module
 *      workers (`worker-src 'self' blob:`), never fetched from a CDN (`connect-src 'self'`).
 *
 * `csp.test.ts` asserts the policy has no `unsafe-eval`; this file is what lets us keep that promise
 * while still shipping Monaco. `setupMonaco()` is idempotent and must run before the first editor
 * mounts.
 */
let done = false;

export function setupMonaco(): typeof monaco {
  if (!done) {
    self.MonacoEnvironment = {
      getWorker(_workerId, label) {
        if (label === 'typescript' || label === 'javascript') return new tsWorker();
        if (label === 'json') return new jsonWorker();
        if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
        if (label === 'html' || label === 'handlebars' || label === 'razor')
          return new htmlWorker();
        return new editorWorker();
      },
    };
    ensureThemes(monaco);
    done = true;
  }
  return monaco;
}
