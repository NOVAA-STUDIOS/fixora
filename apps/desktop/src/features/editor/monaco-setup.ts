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
 * `monaco.languages.typescript`'s bundled type in this monaco-editor version is a stub
 * (`{ deprecated: true }`) — the runtime API is unchanged and still fully functional, only its
 * shipped `.d.ts` was stripped. This is the narrow shape both this file and code-editor.tsx's
 * tsconfig loader actually call, cast once here rather than `as any` at every call site.
 */
export type TsLanguageDefaults = {
  setCompilerOptions: (options: Record<string, unknown>) => void;
  getCompilerOptions: () => Record<string, unknown>;
  setDiagnosticsOptions: (options: Record<string, unknown>) => void;
  addExtraLib: (content: string, filePath?: string) => void;
};
export type TsLanguageApi = {
  typescriptDefaults: TsLanguageDefaults;
  javascriptDefaults: TsLanguageDefaults;
  ScriptTarget: Record<string, number>;
  ModuleResolutionKind: Record<string, number>;
  JsxEmit: Record<string, number>;
};
export function typescriptLanguageApi(m: typeof monaco): TsLanguageApi {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- stub type only, see the doc above
  return m.languages.typescript as unknown as TsLanguageApi;
}

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

    // Better TS defaults — overridden per-project by code-editor.tsx's own tsconfig.json load,
    // this is just the floor every file gets before (or without) one.
    const ts = typescriptLanguageApi(monaco);
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget['ESNext'],
      moduleResolution: ts.ModuleResolutionKind['Bundler'],
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      jsx: ts.JsxEmit['ReactJSX'],
      allowJs: true,
      checkJs: false,
      noEmit: true,
      strict: false, // Will be overridden by project tsconfig
    });

    // Better diagnostics
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    });

    // JS defaults too
    ts.javascriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget['ESNext'],
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      allowJs: true,
      checkJs: true,
    });

    // Extra libs — non-JS/TS module specifiers (assets) the TS service otherwise has no
    // declaration for, so importing one doesn't read as an error.
    ts.typescriptDefaults.addExtraLib(
      `declare module '*.svg' { const content: string; export default content; }
declare module '*.png' { const content: string; export default content; }
declare module '*.css' { const content: Record<string, string>; export default content; }`,
      'file:///node_modules/@types/assets/index.d.ts',
    );

    done = true;
  }
  return monaco;
}
