import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { grammarFor, type GrammarId } from '@fixora/shared-types';

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
 * The grammar to parse with — re-exported from the contract layer, NOT defined here.
 *
 * It moved to `@fixora/shared-types` because the repair prompt must name the same dialect this
 * parser will judge the reply against, and `core-ai` cannot depend on this package (ESM-only,
 * tree-sitter WASM). Two definitions would eventually disagree, and a model instructed in one
 * dialect but verified in another is exactly the defect the discriminator prevents. Everything in
 * this file below is the WASM-file mapping, which is genuinely this package's concern.
 */
export type { GrammarId };

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

export { grammarFor };

/** Absolute path to a grammar's prebuilt WASM. */
export function grammarWasmPath(grammar: GrammarId): string {
  const outDir = join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  return join(outDir, GRAMMAR_FILE[grammar]);
}
