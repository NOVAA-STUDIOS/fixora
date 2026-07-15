import { createHash } from 'node:crypto';

import type { FindingSource, SymbolRef } from '@fixora/shared-types';

/**
 * A `Finding.id` that is **stable across runs** (TDD §5.1). This is the load-bearing detail the
 * whole verification story rests on: the comparison "did the fix resolve *this* finding, or
 * introduce a *new* one?" and the golden corpus both require that the same logical problem keeps the
 * same id across analysis runs — including runs *after a patch has shifted every line in the file*.
 *
 * So the id hashes the things that identify the problem, never the things that move:
 *
 *   - `source` + `ruleId` — *what* is wrong (a strengthening of the TDD formula: rule ids are only
 *     tool-namespaced by convention, so including the source makes a cross-tool id collision
 *     impossible without weakening stability, since the source of a given finding never changes).
 *   - `file` — *where*, at the coarse grain that survives edits (a workspace-relative path).
 *   - the enclosing symbol's **name and kind** — *where*, at the grain that survives edits. Never
 *     its line number: the symbol keeps its identity when code above it grows or shrinks.
 *   - a **normalised snippet** — *which occurrence*, robust to reformatting.
 *
 * Deliberately excluded: the raw line/column. Those shift the instant a patch applies, which is
 * exactly when the id must not change.
 */

export interface FindingIdInput {
  source: FindingSource;
  ruleId: string;
  /** Workspace-relative POSIX path. */
  file: string;
  /** The function/class/etc. the finding sits in, if tree-sitter resolved one. */
  enclosingSymbol?: SymbolRef | undefined;
  /** The code the finding points at — raw; this function normalises it. */
  snippet: string;
}

/**
 * Collapse cosmetic variation a reformat would introduce, so the id survives it: runs of whitespace
 * become a single space, and the ends are trimmed. Identifiers and operators are left untouched — a
 * finding on `foo` is genuinely a different finding from one on `bar`, and lowercasing or stripping
 * tokens would merge findings that are not the same.
 */
export function normalizeSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, ' ').trim();
}

/** A stable identity key for the enclosing symbol — name and kind, never position. */
function symbolKey(symbol: SymbolRef | undefined): string {
  return symbol === undefined ? '' : `${symbol.kind}:${symbol.name}`;
}

/**
 * The stable finding id: a 128-bit hex digest (32 chars — collision-safe for a workspace's findings,
 * and short enough to read in a log). The parts are hashed as a **JSON-encoded tuple** rather than a
 * delimiter-joined string: JSON quotes and escapes each field, so no value (a normalised snippet
 * does contain spaces) can bleed across a field boundary and forge a different finding's id.
 */
export function findingId(input: FindingIdInput): string {
  const key = JSON.stringify([
    input.source,
    input.ruleId,
    input.file,
    symbolKey(input.enclosingSymbol),
    normalizeSnippet(input.snippet),
  ]);
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}
