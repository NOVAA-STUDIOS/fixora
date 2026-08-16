import { posix } from 'node:path';

import type { Language, SymbolRef } from '@fixora/shared-types';

import type { AnalysisFile } from '../analyzer.js';

/**
 * Cross-file context: the definition of an imported symbol the repair target references.
 *
 * Same-file context (`context-selector.ts`) can only ever show the import STATEMENT — the line
 * `import { User } from './types'`. That tells a model the name exists and nothing about its shape,
 * which is why a model "fixes" a type error by inventing a type that already exists one file over.
 * This resolves the relative import and sends the referenced symbol's signature.
 *
 * Deliberately conservative, and the limits are the point:
 *
 *  - **Relative specifiers only** (`./x`, `../x`). A bare specifier (`react`, `node:fs`) is rejected
 *    before any filesystem work: resolving one means walking `node_modules`, honouring `exports`
 *    maps, conditions and symlinks — a resolver's worth of surface for context that is usually
 *    published `.d.ts` the model already knows.
 *  - **Never reads from disk.** Candidates are matched against `context.files`, the set main already
 *    vetted (path guard, secrets denylist, ignore rules — Security §3), and their text comes from
 *    `readSource`. A file outside that set is unreachable here by construction, so this cannot be
 *    used to reach a path analysis was never allowed to see.
 *  - **Signature, not body** — the same `WHOLE_BODY_KINDS` rule the same-file selector uses.
 */

/** Resolved foreign context, as the prompt carries it: a label and already-extracted text. */
export interface CrossFileContext {
  readonly label: string;
  readonly text: string;
}

/** A type/enum's body IS its contract; a function's is not — its signature is. Mirrors context-selector.ts. */
const WHOLE_BODY_KINDS = new Set<string>(['interface', 'type', 'struct', 'enum']);
/** Never send more than this many lines for one symbol — a huge interface gets its head. */
const MAX_LINES = 14;
/** Cross-file lookups are the expensive kind of context; a repair needs a couple, not a survey. */
const MAX_ENTRIES = 3;

/** Extension candidates per language, in resolution order — `./x` may be `x.ts`, `x/index.ts`, … */
const EXTENSIONS: Partial<Record<Language, readonly string[]>> = {
  typescript: ['.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs', '/index.js', '/index.jsx'],
  python: ['.py', '/__init__.py'],
  go: ['.go'],
};

/** True for `./x` and `../x` only. Everything else — bare, absolute, protocol — is out of scope. */
export function isRelativeSpecifier(module: string): boolean {
  return module.startsWith('./') || module.startsWith('../');
}

/**
 * Resolve a relative specifier against the set of files already in the analysis run. Returns null
 * when nothing matches — a `.css` import, a path outside the vetted set, a typo — which is a normal
 * outcome, never an error.
 */
export function resolveRelativeImport(
  fromFile: string,
  module: string,
  language: Language,
  files: readonly AnalysisFile[],
): AnalysisFile | null {
  if (!isRelativeSpecifier(module)) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), module));
  const byPath = new Map(files.map((f) => [f.file, f]));

  // An explicit extension in the specifier wins, then the language's candidates in order.
  const direct = byPath.get(base);
  if (direct !== undefined) return direct;
  for (const ext of EXTENSIONS[language] ?? []) {
    const hit = byPath.get(`${base}${ext}`);
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The symbol's signature, capped — its whole body only for the kinds whose body IS the contract. */
function signatureOf(symbol: SymbolRef, source: string): string {
  const lines = source.split(/\r?\n/);
  const start = symbol.location.startLine;
  const end = WHOLE_BODY_KINDS.has(symbol.kind)
    ? Math.min(symbol.location.endLine, start + MAX_LINES - 1)
    : start;
  return lines.slice(start - 1, end).join('\n');
}

/**
 * For each name the target scope references that a relative import brings in, the imported symbol's
 * signature from the file it actually lives in.
 *
 * `symbolsOf` and `sourceOf` are injected rather than read here: the caller already has both from
 * the run's cached, shared parse (`context.symbolsFor` / `context.readSource`), so this re-parses
 * nothing and touches no filesystem of its own.
 */
export function selectCrossFileContext(input: {
  fromFile: string;
  language: Language;
  files: readonly AnalysisFile[];
  /** Import statements in the current file, with the exact text of each statement line. */
  imports: readonly { module: string; statementText: string }[];
  /** Identifiers the repair target actually references. */
  referenced: ReadonlySet<string>;
  symbolsOf: (file: AnalysisFile) => readonly SymbolRef[];
  sourceOf: (file: AnalysisFile) => string | null;
}): CrossFileContext[] {
  const out: CrossFileContext[] = [];
  const seen = new Set<string>();

  for (const imp of input.imports) {
    if (out.length >= MAX_ENTRIES) break;
    if (!isRelativeSpecifier(imp.module)) continue;

    const target = resolveRelativeImport(input.fromFile, imp.module, input.language, input.files);
    if (target === null) continue;
    const source = input.sourceOf(target);
    if (source === null) continue;

    for (const symbol of input.symbolsOf(target)) {
      if (out.length >= MAX_ENTRIES) break;
      // Two gates, both required: the target scope must reference the name, AND this import
      // statement must be what brings it in — otherwise a same-named local symbol in an unrelated
      // imported file would be pulled in as if it were the one being used.
      if (!input.referenced.has(symbol.name)) continue;
      if (!imp.statementText.includes(symbol.name)) continue;
      const key = `${target.file}:${symbol.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const text = signatureOf(symbol, source);
      if (text.trim() === '') continue;
      out.push({ label: `from '${imp.module}': ${symbol.kind} ${symbol.name}`, text });
    }
  }

  return out;
}
