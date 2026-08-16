import { neighbourRelevanceScore, type SymbolRef } from '@fixora/shared-types';

/** The minimal import shape the Dependency selector needs (satisfied by `ExtractedImport`). */
export interface ImportLike {
  readonly module: string;
  readonly location: { readonly startLine: number; readonly endLine: number };
}

/**
 * The Semantic and Dependency scope layers (Repair Context Engine v3).
 *
 * The AST scope (v2) is the code the model rewrites. But to rewrite it correctly the model also needs
 * what that code REFERS to: the imports it depends on (Dependency scope) and the same-file
 * declarations it uses — the interface it implements, the type it returns, the helper it calls
 * (Semantic scope). Sending the whole file would drown the signal and blow the budget; sending
 * nothing is why a model "fixes" a type error by inventing a type that already exists two lines up.
 *
 * This selects ONLY what the target scope actually references, by name, from the structure the parser
 * already produced — never the whole file, never unrelated symbols. Each item is a range into the same
 * file, so the caller slices the exact text and the gate still sees every byte before it leaves.
 */

export interface ContextRange {
  /** A human label for the prompt, e.g. `import from 'react'` or `interface Settings`. */
  label: string;
  startLine: number;
  endLine: number;
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;
/** Keywords that appear on import lines but are not references worth matching. */
const IMPORT_NOISE = new Set(['import', 'from', 'as', 'type', 'require', 'const']);
/** A type/enum's whole body is its contract and worth sending; a function's is not — its signature is. */
const WHOLE_BODY_KINDS = new Set<string>(['interface', 'type', 'struct', 'enum']);
/** Keep the assembled context small — this is about the RELEVANT few, not a file dump. */
const MAX_NEIGHBOURS = 6;
/** Never send more than this many lines for one neighbour; a huge type gets its head, not all of it. */
const MAX_NEIGHBOUR_LINES = 14;

function identifiers(text: string): Set<string> {
  return new Set(text.match(IDENTIFIER) ?? []);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Same-file candidates always have a line, so they always get the proximity term. The rule itself
 * lives in `shared-types` — see `neighbourRelevanceScore` for why it is shared, not duplicated. */
function relevanceScore(
  range: ContextRange,
  findingLine: number,
  diagnosticText: string,
): number {
  return neighbourRelevanceScore(range.label, range.startLine, findingLine, diagnosticText);
}

/**
 * Select the imports and same-file declarations the target scope references. `targetSymbolName` (the
 * enclosing symbol, if any) is excluded so a recursive function does not include itself.
 */
export function selectRepairContext(input: {
  source: string;
  scopeStartLine: number;
  scopeEndLine: number;
  symbols: readonly SymbolRef[];
  imports: readonly ImportLike[];
  targetSymbolName: string | null;
  /**
   * The finding's own line and diagnostic text (message + snippet), used only to ORDER candidates
   * before the cap — never to select or reject one. Optional so existing callers and tests keep
   * working unchanged; omitted, ordering falls back to the previous imports-then-symbols order.
   */
  findingLine?: number;
  diagnosticText?: string;
}): ContextRange[] {
  const lines = input.source.split('\n');
  const scopeText = lines.slice(input.scopeStartLine - 1, input.scopeEndLine).join('\n');
  const referenced = identifiers(scopeText);

  const out: ContextRange[] = [];

  // Dependency scope: an import is relevant when a binding it introduces is used in the scope. The
  // binding names are the identifiers on the import line minus keywords and the module string itself.
  for (const imp of input.imports) {
    const line = lines[imp.location.startLine - 1] ?? '';
    const bindings = [...identifiers(line)].filter(
      (t) => !IMPORT_NOISE.has(t) && !imp.module.includes(t),
    );
    if (bindings.some((b) => referenced.has(b))) {
      out.push({
        label: `import from '${imp.module}'`,
        startLine: imp.location.startLine,
        endLine: imp.location.endLine,
      });
    }
  }

  // Semantic scope: a same-file symbol whose NAME the scope references, that is not the target itself
  // and does not overlap the scope (that would be sending the scope back to itself).
  for (const sym of input.symbols) {
    if (sym.name === input.targetSymbolName) continue;
    if (
      overlaps(
        sym.location.startLine,
        sym.location.endLine,
        input.scopeStartLine,
        input.scopeEndLine,
      )
    )
      continue;
    if (!referenced.has(sym.name)) continue;
    const start = sym.location.startLine;
    const fullEnd = sym.location.endLine;
    const end = WHOLE_BODY_KINDS.has(sym.kind)
      ? Math.min(fullEnd, start + MAX_NEIGHBOUR_LINES - 1)
      : start; // a function/class contributes its signature line, not its whole body
    out.push({ label: `${sym.kind} ${sym.name}`, startLine: start, endLine: end });
  }

  // Dedupe by range (an import and a symbol can never share one, but two references can).
  const seen = new Set<string>();
  const deduped = out.filter((r) => {
    const key = `${String(r.startLine)}:${String(r.endLine)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  /**
   * Rank before capping. Previously this was `deduped.slice(0, MAX_NEIGHBOURS)` on raw
   * imports-then-symbols order, so which context survived the cap was decided by declaration order
   * in the file — the type the diagnostic actually names could be dropped in favour of an unrelated
   * import that merely appeared earlier. Ordering is the ONLY thing this changes: the same
   * candidates are eligible, and `MAX_NEIGHBOURS` still bounds the total.
   *
   * A stable sort (`Array.prototype.sort` is stable) means equal scores keep the old
   * imports-then-symbols order, so this degrades exactly to the previous behaviour when the
   * finding context is absent or nothing scores differently.
   */
  if (input.findingLine === undefined || input.diagnosticText === undefined) {
    return deduped.slice(0, MAX_NEIGHBOURS);
  }
  const line = input.findingLine;
  const text = input.diagnosticText;
  return deduped
    .map((range) => ({ range, score: relevanceScore(range, line, text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEIGHBOURS)
    .map((scored) => scored.range);
}
