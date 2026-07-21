import type { Autofix, AutofixEdit, Finding, Language, RepairStrategy } from '@fixora/shared-types';

import { parse } from '../parser/tree-sitter.js';

export type { RepairStrategy };

/**
 * Deterministic micro-repairs — Goal 3.
 *
 * A micro-repair applies a fix the *analyzer itself* authored (ESLint's `fix`, Ruff's edits), never a
 * fix Fixora invented by string-munging. That distinction is the whole safety argument: the linter's
 * fixer is AST-based, so the edit is already semantics-preserving by construction. We still refuse to
 * trust it — every micro-repair is re-parsed here (the parser gate), and the caller runs it through
 * the verifier (overlay re-analysis) and the formatter before Apply is ever enabled. Deterministic,
 * minimal, and gate-proven: a one-token fix stays a one-token edit, and nothing reaches the file that
 * did not survive being read back as a tree.
 *
 * There is no AI in this module and no heuristic text replacement. If a finding has no tool-authored
 * autofix, `deterministicRepair` returns null and the finding is left to the AI or to the developer.
 */

/** Rules for which no machine can know the intent, so neither an autofix nor an AI guess is offered. */
const MANUAL_ONLY_RULES = new Set<string>([
  'TS2304', // "Cannot find name X" — the correct identifier is a guess only the author can make
  'F821', // Ruff undefined name — same
]);

export function classifyRepair(finding: Finding): RepairStrategy {
  if (finding.autofix !== undefined) return 'safe-auto';
  if (MANUAL_ONLY_RULES.has(finding.ruleId)) return 'manual';
  return 'ai-required';
}

export interface MicroRepairResult {
  /** The full patched file content, ready to hand to the verifier. */
  patched: string;
  /** The exact edits applied — minimal by construction, for preview and audit. */
  edits: readonly AutofixEdit[];
  /** The parser gate: does the patched file parse without error under its own grammar? */
  parseOk: boolean;
  /** Which tool authored the fix. */
  source: Autofix['source'];
}

/**
 * Apply a set of character-offset edits to `source`.
 *
 * Edits are applied right-to-left so earlier offsets stay valid as later text changes length. Ranges
 * are validated: an out-of-bounds or overlapping edit set is rejected (returns null) rather than
 * producing a corrupted splice — a fix we cannot apply cleanly is not a fix.
 */
export function applyEdits(source: string, edits: readonly AutofixEdit[]): string | null {
  if (edits.length === 0) return null;
  const sorted = [...edits].sort((a, b) => a.range[0] - b.range[0]);
  // Walk ascending to validate bounds and non-overlap...
  let prevEnd = -1;
  for (const edit of sorted) {
    const [start, end] = edit.range;
    if (start < 0 || end > source.length || start > end) return null; // out of bounds
    if (start < prevEnd) return null; // overlapping — ambiguous, refuse
    prevEnd = end;
  }
  // ...then apply from the end so earlier offsets stay valid as text lengths change.
  let out = source;
  for (const edit of [...sorted].reverse()) {
    const [start, end] = edit.range;
    out = out.slice(0, start) + edit.text + out.slice(end);
  }
  return out;
}

/**
 * Produce a deterministic micro-repair for a finding, or null if it has no tool-authored fix.
 *
 * The returned result has already passed the parser gate (`parseOk`). It has NOT yet passed the
 * verifier or the formatter — those are the caller's responsibility, and Apply must stay disabled
 * until all three agree. Separating them keeps this module pure (no fs, no overlay) and unit-testable.
 */
export function deterministicRepair(input: {
  finding: Finding;
  source: string;
  language: Language;
  filePath: string;
}): Promise<MicroRepairResult | null> {
  return (async (): Promise<MicroRepairResult | null> => {
    const { finding, source, language, filePath } = input;
    if (finding.autofix === undefined) return null;

    const patched = applyEdits(source, finding.autofix.edits);
    if (patched === null) return null; // edits did not apply cleanly

    // The parser gate: read the patched file back as a tree under its own (JSX-aware) grammar. A fix
    // that does not parse never leaves this function as applicable.
    let parseOk: boolean;
    try {
      const tree = await parse(language, patched, filePath);
      parseOk = !tree.root.hasError;
      tree.dispose();
    } catch {
      parseOk = false;
    }

    return { patched, edits: finding.autofix.edits, parseOk, source: finding.autofix.source };
  })();
}
