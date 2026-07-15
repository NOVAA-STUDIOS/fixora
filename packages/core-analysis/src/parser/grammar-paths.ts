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

const GRAMMAR_FILE: Record<Language, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
};

/** Absolute path to a language's prebuilt grammar WASM. */
export function grammarWasmPath(language: Language): string {
  const outDir = join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  return join(outDir, GRAMMAR_FILE[language]);
}
