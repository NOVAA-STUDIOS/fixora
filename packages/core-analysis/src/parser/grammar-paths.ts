import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Language } from '@fixora/shared-types';

/**
 * Resolves the WASM assets tree-sitter needs at runtime: the core `tree-sitter.wasm` (from
 * `web-tree-sitter`) and one prebuilt grammar per language (from `tree-sitter-wasms`). These are
 * *data*, not native executables — nothing here needs signing (ADR-007 is about not bundling the
 * language *tooling*; the grammars are ours to ship). Packaging (M8) must keep these `.wasm` files
 * on disk and unpacked, since tree-sitter reads them as files.
 */

const require = createRequire(import.meta.url);

/** Absolute path to the tree-sitter core runtime WASM. */
export function coreWasmPath(): string {
  return join(dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm');
}

/**
 * The grammar to parse with. This is finer-grained than `Language`: TypeScript ships as TWO
 * tree-sitter grammars — `typescript` (no JSX) and `tsx` (JSX) — and the plain one reports the WHOLE
 * file as a syntax error the moment it meets a `<Tag>`. A `.tsx` file is `Language: 'typescript'` for
 * tool selection (eslint/tsc treat them the same) but MUST use the tsx grammar to parse. Conflating
 * the two is what made verification reject every valid repair in a React file as "does not parse".
 */
export type GrammarId = Language | 'tsx';

const GRAMMAR_FILE: Record<GrammarId, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  json: 'tree-sitter-json.wasm',
  // Already vendored by `tree-sitter-wasms` — no new dependency was needed to support them, only
  // this wiring. These are what make a css/html repair verifiable at all: the worker's verify step
  // re-parses the patched file with the grammar for its language, so a repair that does not parse
  // becomes a `regression` and is refused rather than offered.
  css: 'tree-sitter-css.wasm',
  html: 'tree-sitter-html.wasm',
};

/**
 * Choose the grammar for a file. Only `.tsx` needs special handling: the JavaScript grammar already
 * includes JSX, so `.jsx` (Language: 'javascript') parses correctly, and every other language maps
 * straight through. The file path is the only thing that distinguishes `.ts` from `.tsx`, since both
 * are `Language: 'typescript'`.
 */
export function grammarFor(language: Language, filePath: string): GrammarId {
  if (language === 'typescript' && /\.tsx$/i.test(filePath)) return 'tsx';
  return language;
}

/** Absolute path to a grammar's prebuilt WASM. */
export function grammarWasmPath(grammar: GrammarId): string {
  const outDir = join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  return join(outDir, GRAMMAR_FILE[grammar]);
}
