import type { Language } from './analysis.js';

/**
 * The grammar discriminator, shared by everything that must agree on "what dialect is this file?".
 *
 * It lives in the contract layer rather than in `core-analysis` because two independent consumers
 * need the identical answer and must never drift:
 *
 *  - the **verifier** parses a patched file with the grammar this names (`core-analysis`'s
 *    `parse()` -> `grammarWasmPath()`), and
 *  - the **repair prompt** tells the model which dialect it may write in (`core-ai`'s
 *    `language-rules.ts`).
 *
 * If those two ever disagreed, Fixora would instruct a model in one dialect and judge its reply in
 * another — which is precisely the failure this discriminator exists to make impossible. `core-ai`
 * depends only on this package (never on `core-analysis`, which is ESM-only and carries the
 * tree-sitter WASM runtime), so this is the one place both can reach.
 */

/**
 * Finer-grained than `Language`: TypeScript ships as TWO tree-sitter grammars — `typescript` (no
 * JSX) and `tsx` (JSX) — and the plain one reports the WHOLE file as a syntax error the moment it
 * meets a `<Tag>`. A `.tsx` file is `Language: 'typescript'` for tool selection (eslint/tsc treat
 * them the same) but MUST use the tsx grammar to parse.
 */
export type GrammarId = Language | 'tsx';

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
